import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { PurgeQueueCommand } from "@aws-sdk/client-sqs";
import { ApplicationError, hashValue, payloadHash } from "../../src/application/contracts";
import { ProcessWager } from "../../src/application/process-wager";
import { WagerTransactionRejected } from "../../src/domain/events";
import { InboxMessage, OutboxMessage } from "../../src/domain/messages";
import { type WagerInput, WagerTransaction } from "../../src/domain/wager";
import { DLQ_QUEUE, EVENTS_QUEUE, INPUT_QUEUE } from "../../src/infrastructure/messaging/sqs";
import { connect } from "../../src/infrastructure/persistence/orm";
import { PgStore, PgUnit } from "../../src/infrastructure/persistence/store";
import { createRuntime, type Runtime } from "../../src/runtime";
import { WagerConsumer } from "../../src/workers/consumer";
import { OutboxPublisher } from "../../src/workers/outbox";

// This suite resets ONLY the dedicated wager_test DB and this project's local queues.
process.env.DATABASE_URL = "postgresql://wager_local:wager_local_only@127.0.0.1:55432/wager_test";
process.env.SQS_ENDPOINT = "http://127.0.0.1:4568";
process.env.REFERENCE_BACKOFF_MS = "50";
process.env.REFERENCE_MAX_ATTEMPTS = "3";
process.env.OUTBOX_LEASE_MS = "1000";
process.env.VISIBILITY_SECONDS = "2";
let r: Runtime;
const children: ReturnType<typeof Bun.spawn>[] = [];
const childEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  SQS_ENDPOINT: process.env.SQS_ENDPOINT,
  REFERENCE_BACKOFF_MS: "50",
  REFERENCE_MAX_ATTEMPTS: "3",
  OUTBOX_LEASE_MS: "1000",
  VISIBILITY_SECONDS: "2",
  WORKERS: "false",
  HOST: "127.0.0.1",
};
async function waitFor(check: () => Promise<boolean>, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(50);
  }
  throw new Error("Condition timed out");
}
function child(file: string, extra: Record<string, string> = {}) {
  mkdirSync(".artifacts/tests", { recursive: true });
  const path = `.artifacts/tests/process-${crypto.randomUUID()}.log`;
  const fd = openSync(path, "w");
  const proc = Bun.spawn([process.execPath, file], {
    cwd: process.cwd(),
    env: { ...childEnv, ...extra },
    stdout: fd,
    stderr: fd,
  });
  closeSync(fd);
  children.push(proc);
  return { proc, path };
}
async function stop(proc: ReturnType<typeof Bun.spawn>, signal: "SIGTERM" | "SIGKILL" = "SIGTERM") {
  if (proc.exitCode === null) {
    proc.kill(signal);
    await proc.exited;
  }
}
async function sql<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  return r.orm.em.getConnection().execute<T[]>(query, params);
}
async function open(amount = "100.00") {
  return r.processor.open({
    playerId: crypto.randomUUID(),
    initialBalance: { amount, currency: "BRL" },
  });
}
function input(
  w: Awaited<ReturnType<typeof open>>,
  kind: WagerInput["kind"] = "BET",
  amount = "10.00",
  ref?: string,
): WagerInput {
  return {
    providerId: "test-provider",
    externalTransactionId: crypto.randomUUID(),
    walletId: w.id,
    playerId: w.playerId,
    roundId: "round",
    gameId: "game",
    kind,
    money: { amount, currency: "BRL" },
    ...(ref ? { referenceExternalTransactionId: ref } : {}),
  };
}
async function execute(p: WagerInput, key = p.externalTransactionId) {
  return r.processor.execute(p, key, { correlationId: "integration" });
}
function envelope(p: WagerInput, messageId: string = crypto.randomUUID()) {
  return {
    messageId,
    type: "WagerTransactionRequested",
    occurredAt: new Date().toISOString(),
    data: { ...p, idempotencyKey: p.externalTransactionId },
  };
}
async function enqueue(p: WagerInput, messageId?: string) {
  const body = envelope(p, messageId);
  await r.sqs.send(INPUT_QUEUE, JSON.stringify(body), p.walletId, crypto.randomUUID());
  return body;
}
async function assertAllBalanced() {
  const rows = await sql<{ id: string; balance: string; total: string }>(
    "SELECT w.id,w.balance::text,COALESCE(sum(CASE l.direction WHEN 'CREDIT' THEN l.amount ELSE -l.amount END),0)::text total FROM wallets w LEFT JOIN wallet_ledger l ON l.wallet_id=w.id GROUP BY w.id",
  );
  for (const row of rows) expect(row.balance).toBe(row.total);
}
beforeAll(async () => {
  // A separate ORM connection creates the dedicated test database, never drops the demo database.
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://wager_local:wager_local_only@127.0.0.1:55432/wager";
  const admin = await connect();
  try {
    const exists = await admin.em
      .getConnection()
      .execute("SELECT 1 FROM pg_database WHERE datname='wager_test'");
    if (exists.length === 0) await admin.em.getConnection().execute("CREATE DATABASE wager_test");
  } finally {
    await admin.close(true);
    process.env.DATABASE_URL = original;
  }
  r = await createRuntime();
  await r.orm.migrator.down({ to: 0 });
  await r.orm.migrator.up();
  // The demo queue configuration uses 10s visibility. Receive overrides it for crash tests.
  const visibility = process.env.VISIBILITY_SECONDS;
  process.env.VISIBILITY_SECONDS = "10";
  try {
    await r.sqs.setup();
  } finally {
    process.env.VISIBILITY_SECONDS = visibility;
  }
  for (const name of [INPUT_QUEUE, DLQ_QUEUE, EVENTS_QUEUE])
    await r.sqs.client.send(new PurgeQueueCommand({ QueueUrl: await r.sqs.url(name) }));
}, 30000);
afterEach(async () => {
  if (r) await assertAllBalanced();
});
afterAll(async () => {
  for (const proc of children) await stop(proc, "SIGKILL");
  if (r) {
    await assertAllBalanced();
    await r.close();
  }
});

describe("PostgreSQL constraints and atomicity", () => {
  test("versioned migration down/up and database constraints", async () => {
    await r.orm.migrator.down({ to: 0 });
    expect(
      (await sql("SELECT 1 FROM information_schema.tables WHERE table_name='wallets'")).length,
    ).toBe(0);
    await r.orm.migrator.up();
    const w = await open();
    expect(w.version).toBe(1);
    await expect(
      r.processor.open({
        playerId: w.playerId,
        initialBalance: { amount: "1.00", currency: "BRL" },
      }),
    ).rejects.toMatchObject({ code: "WALLET_EXISTS" });
    await expect(sql("UPDATE wallets SET balance=-1 WHERE id=?", [w.id])).rejects.toMatchObject({
      code: "23514",
    });
    await expect(sql("UPDATE wallets SET balance=5000 WHERE id=?", [w.id])).rejects.toMatchObject({
      code: "23514",
    });
    await expect(
      sql("UPDATE wallets SET version=version+1 WHERE id=?", [w.id]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      sql("UPDATE wallet_ledger SET amount=amount WHERE wallet_id=?", [w.id]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(sql("DELETE FROM wallet_ledger WHERE wallet_id=?", [w.id])).rejects.toMatchObject({
      code: "23514",
    });
    await expect(sql("TRUNCATE wallet_ledger")).rejects.toMatchObject({ code: "23514" });
    const [opening] = await sql<{ id: string }>(
      "SELECT id FROM wager_transactions WHERE wallet_id=?",
      [w.id],
    );
    await expect(
      sql("UPDATE wager_transactions SET status='PENDING' WHERE id=?", [opening!.id]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      sql("INSERT INTO idempotency_keys SELECT * FROM idempotency_keys LIMIT 1"),
    ).rejects.toMatchObject({ code: "23505" });
  });
  test("failure at final pre-commit point rolls back wallet, wager, ledger, inbox, outbox and key", async () => {
    const w = await open();
    const p = input(w);
    const messageId = crypto.randomUUID();
    const faulty = new ProcessWager(new PgStore(r.orm), r.telemetry, {
      async beforeCommit() {
        throw new Error("INJECTED_PRE_COMMIT");
      },
    });
    const before = await sql<{ count: string }>(
      "SELECT count(*)::text count FROM outbox WHERE aggregate_id=?",
      [w.id],
    );
    await expect(
      faulty.execute(p, p.externalTransactionId, { correlationId: "atomic", messageId }),
    ).rejects.toThrow("INJECTED_PRE_COMMIT");
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("100.00");
    expect(
      (
        await sql("SELECT id FROM wager_transactions WHERE external_id=?", [
          p.externalTransactionId,
        ])
      ).length,
    ).toBe(0);
    expect((await sql("SELECT * FROM inbox WHERE message_id=?", [messageId])).length).toBe(0);
    expect(
      (await sql("SELECT * FROM idempotency_keys WHERE key=?", [p.externalTransactionId])).length,
    ).toBe(0);
    expect(
      await sql("SELECT count(*)::text count FROM outbox WHERE aggregate_id=?", [w.id]),
    ).toEqual(before);
    expect((await r.queries.ledger(w.id)).items.length).toBe(1);
  });
  test("replay preserves original balance; new key alias is bound; divergent payload conflicts", async () => {
    const w = await open();
    const p = input(w);
    const first = await execute(p);
    await execute(input(w, "WIN", "50.00"));
    const replay = await execute(p);
    expect(replay.balance).toEqual(first.balance);
    expect(replay.idempotentReplay).toBe(true);
    const alias = crypto.randomUUID();
    expect((await execute(p, alias)).transactionId).toBe(first.transactionId);
    await expect(execute(input(w), alias)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      execute({ ...p, money: { amount: "11.00", currency: "BRL" } }),
    ).rejects.toBeInstanceOf(ApplicationError);
  });
  test("concurrent duplicate REFUND and ROLLBACK; reference/type uniqueness lives in PostgreSQL", async () => {
    const w = await open();
    const bet = input(w, "BET", "20.00");
    await execute(bet);
    const refunds = await Promise.all([
      execute(input(w, "REFUND", "20.00", bet.externalTransactionId)),
      execute(input(w, "REFUND", "20.00", bet.externalTransactionId)),
    ]);
    expect(refunds.map((x) => x.status).sort()).toEqual(["PROCESSED", "REJECTED"]);
    expect(refunds.find((x) => x.status === "REJECTED")?.failureCode).toBe("ALREADY_REVERSED");
    // README permits one REFUND and one ROLLBACK against the same BET.
    const rollbacks = await Promise.all([
      execute(input(w, "ROLLBACK", "20.00", bet.externalTransactionId)),
      execute(input(w, "ROLLBACK", "20.00", bet.externalTransactionId)),
    ]);
    expect(rollbacks.map((x) => x.status).sort()).toEqual(["PROCESSED", "REJECTED"]);
    const successful = refunds.find((x) => x.status === "PROCESSED")!;
    await expect(
      sql(
        `INSERT INTO wager_transactions SELECT ?::uuid,provider_id,?,wallet_id,player_id,currency,amount,kind,status,reference_id,payload_hash,input,?,failure_code,result_balance,result_currency,created_at,processed_at,reference_attempts,next_attempt_at,correlation_id,causation_id FROM wager_transactions WHERE id=?`,
        [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), successful.transactionId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("120.00");
  });
  test("LOSS, rejected references and reversal insufficient funds remain auditable without ledger", async () => {
    const w = await open("0.00");
    const win = input(w, "WIN", "10.00");
    await execute(win);
    await execute(input(w, "BET", "10.00"));
    const rb = await execute(input(w, "ROLLBACK", "10.00", win.externalTransactionId));
    expect(rb.failureCode).toBe("REVERSAL_INSUFFICIENT_FUNDS");
    const before = (await r.queries.wallet(w.id)).version;
    const loss = await execute(input(w, "LOSS", "0.00"));
    expect(loss.status).toBe("PROCESSED");
    expect((await r.queries.wallet(w.id)).version).toBe(before);
    expect(
      (
        await sql("SELECT * FROM wallet_ledger WHERE transaction_id IN (?,?)", [
          rb.transactionId,
          loss.transactionId,
        ])
      ).length,
    ).toBe(0);
    expect(
      (
        await sql(
          "SELECT * FROM outbox WHERE payload->'data'->>'transactionId'=? AND event_type='WalletBalanceChanged'",
          [loss.transactionId],
        )
      ).length,
    ).toBe(0);
  });
  test("opaque stable cursor excludes later appends; reconciliation reports drift without correction", async () => {
    const w = await open();
    await execute(input(w));
    await execute(input(w));
    const first = await r.queries.ledger(w.id, undefined, "2");
    expect(first.nextCursor).not.toBeNull();
    await execute(input(w, "WIN", "5.00"));
    const second = await r.queries.ledger(w.id, first.nextCursor!, "2");
    expect(second.items.length).toBe(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((x) => x.id)).size).toBe(3);
    await expect(r.queries.ledger(w.id, "garbage")).rejects.toMatchObject({
      code: "INVALID_CURSOR",
    });
    // Admin-only fault injection simulates historic corruption, then restores it.
    await r.orm.em.fork().transactional(async (em) => {
      const unit = new PgUnit(em);
      await unit.sql("SET LOCAL session_replication_role=replica");
      await unit.sql("UPDATE wallets SET balance=balance+1 WHERE id=?", [w.id]);
    });
    try {
      const report = await r.queries.reconcile(w.id);
      expect(report.consistent).toBe(false);
      expect(report.difference.amount).toBe("0.01");
      expect((await r.queries.wallet(w.id)).balance).toEqual(report.storedBalance);
    } finally {
      await sql("UPDATE wallets SET balance=balance-1 WHERE id=?", [w.id]);
    }
  });
});

describe("real parallel HTTP processes and Bun decorators", () => {
  const ports = [3211, 3212, 3213];
  const servers: ReturnType<typeof child>[] = [];
  async function http(port: number, path: string, body?: unknown, key?: string) {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  test("three independent Nest processes: 50 identical requests debit once", async () => {
    for (const port of ports) servers.push(child("src/main.ts", { PORT: String(port) }));
    for (const port of ports)
      await waitFor(async () => {
        try {
          return (await http(port, "/health/ready")).ok;
        } catch {
          return false;
        }
      });
    expect(new Set(servers.map((x) => x.proc.pid)).size).toBe(3);
    const created = await http(ports[0]!, "/wallets", {
      playerId: crypto.randomUUID(),
      initialBalance: { amount: "100.00", currency: "BRL" },
    });
    expect(created.status).toBe(201);
    const w = (await created.json()) as Awaited<ReturnType<typeof open>>;
    const p = input(w, "BET", "1.00");
    const results = await Promise.all(
      Array.from({ length: 50 }, async (_, i) => {
        const res = await http(ports[i % 3]!, "/wagering/transactions", p, p.externalTransactionId);
        expect(res.status).toBe(200);
        return res.json() as Promise<{ transactionId: string; idempotentReplay: boolean }>;
      }),
    );
    expect(new Set(results.map((x) => x.transactionId)).size).toBe(1);
    expect(results.filter((x) => !x.idempotentReplay).length).toBe(1);
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("99.00");
    expect(
      (await sql("SELECT id FROM wallet_ledger WHERE wallet_id=? AND direction='DEBIT'", [w.id]))
        .length,
    ).toBe(1);
  }, 30000);
  test("two simultaneous 80 bets against 100: exactly one debit; retries preserve result", async () => {
    const w = await open();
    const ps = [input(w, "BET", "80.00"), input(w, "BET", "80.00")];
    const responses = await Promise.all(
      ps.map((p, i) => http(ports[i]!, "/wagering/transactions", p, p.externalTransactionId)),
    );
    expect(responses.map((x) => x.status).sort()).toEqual([200, 422]);
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("20.00");
    for (const p of ps) expect((await execute(p)).idempotentReplay).toBe(true);
    expect(
      (await sql("SELECT id FROM wallet_ledger WHERE wallet_id=? AND direction='DEBIT'", [w.id]))
        .length,
    ).toBe(1);
  });
  test("wallet B commits while wallet A row is held (no global lock)", async () => {
    const a = await open();
    const b = await open();
    let release!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hold = r.orm.em.fork().transactional(async (em) => {
      await new PgUnit(em).lockWallet(a.id);
      locked();
      await gate;
    });
    await acquired;
    const pa = input(a);
    const pb = input(b);
    let aDone = false;
    const aRequest = http(ports[0]!, "/wagering/transactions", pa, pa.externalTransactionId).then(
      (x) => {
        aDone = true;
        return x;
      },
    );
    try {
      const response = await http(
        ports[1]!,
        "/wagering/transactions",
        pb,
        pb.externalTransactionId,
      );
      expect(response.status).toBe(200);
      expect(aDone).toBe(false);
    } finally {
      release();
      await hold;
      await aRequest;
    }
  });
  test("HTTP distinguishes validation, conflict, rejected, pending; queries and health", async () => {
    const w = await open();
    const p = input(w);
    expect((await http(ports[0]!, "/wagering/transactions", p)).status).toBe(400);
    expect(
      (
        await http(
          ports[0]!,
          "/wagering/transactions",
          { ...p, kind: "OPENING" },
          p.externalTransactionId,
        )
      ).status,
    ).toBe(400);
    const first = await execute(p);
    expect(
      (
        await http(
          ports[0]!,
          "/wagering/transactions",
          { ...p, money: { amount: "11.00", currency: "BRL" } },
          p.externalTransactionId,
        )
      ).status,
    ).toBe(409);
    const pending = input(w, "REFUND", "10.00", "absent");
    expect(
      (await http(ports[0]!, "/wagering/transactions", pending, pending.externalTransactionId))
        .status,
    ).toBe(202);
    for (const path of [
      `/wallets/${w.id}`,
      `/wallets/${w.id}/ledger`,
      `/wagering/transactions/${first.transactionId}`,
      `/providers/${p.providerId}/wagering/transactions/${p.externalTransactionId}`,
      "/health/live",
      "/health/ready",
      "/metrics",
    ])
      expect((await http(ports[0]!, path)).status).toBe(200);
    expect((await http(ports[0]!, `/wallets/${w.id}/reconciliation`, {})).status).toBe(200);
  });
  test("dashboard HTTP read models, validation and compiled static frontend", async () => {
    for (const path of [
      "/dashboard/overview",
      "/dashboard/wallets",
      "/dashboard/transactions",
      "/dashboard/operations",
      "/dashboard/health",
    ]) {
      expect((await http(3211, path)).status).toBe(200);
    }
    expect((await http(3211, "/dashboard/overview?currency=XYZ")).status).toBe(400);
    expect((await http(3211, "/dashboard/transactions?limit=101")).status).toBe(400);
    expect((await http(3211, "/dashboard/transactions?status=anything")).status).toBe(400);
    const index = await http(3211, "/");
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("Jungle · Console local");
    expect((await http(3211, "/assets/app.js")).status).toBe(200);
    const health = await (await http(3211, "/dashboard/health")).json();
    expect(health).toMatchObject({ api: true, postgres: true, sqs: true });
  });
  test("service restart preserves original replay and ledger", async () => {
    const w = await open();
    const p = input(w);
    const first = await execute(p);
    for (const s of servers) await stop(s.proc);
    const restarted = child("src/main.ts", { PORT: "3211" });
    try {
      await waitFor(async () => {
        try {
          return (await http(3211, "/health/live")).ok;
        } catch {
          return false;
        }
      });
      const res = await http(3211, "/wagering/transactions", p, p.externalTransactionId);
      const replay = (await res.json()) as {
        transactionId: string;
        balance: unknown;
        idempotentReplay: boolean;
      };
      expect(replay.transactionId).toBe(first.transactionId);
      expect(replay.balance).toEqual(first.balance);
      expect(replay.idempotentReplay).toBe(true);
    } finally {
      await stop(restarted.proc);
    }
  });
});

describe("real SQS, redelivery, reference recovery and outbox", () => {
  test("kill consumer after commit before ACK; restart consumes redelivery once", async () => {
    const w = await open();
    const p = input(w, "BET", "20.00");
    const msg = await enqueue(p);
    const c = child("tests/fixtures/crash-consumer.ts");
    await waitFor(async () => (await Bun.file(c.path).text()).includes("COMMITTED_BEFORE_ACK"));
    await stop(c.proc, "SIGKILL");
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("80.00");
    expect(
      (
        await sql("SELECT * FROM inbox WHERE message_id=? AND processed_at IS NOT NULL", [
          msg.messageId,
        ])
      ).length,
    ).toBe(1);
    await Bun.sleep(2200);
    await r.consumer.tick();
    expect(
      (await sql("SELECT id FROM wallet_ledger WHERE wallet_id=? AND direction='DEBIT'", [w.id]))
        .length,
    ).toBe(1);
    await enqueue(p, msg.messageId);
    await r.consumer.tick();
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("80.00");
  }, 15000);
  test("same inbox ID divergent payload goes to DLQ, without financial mutation", async () => {
    const w = await open();
    const p = input(w);
    const m = await enqueue(p);
    await r.consumer.tick();
    await enqueue({ ...p, money: { amount: "20.00", currency: "BRL" } }, m.messageId);
    await r.consumer.tick();
    const dlq = await r.sqs.receive(DLQ_QUEUE, 0);
    expect(dlq.length).toBe(1);
    for (const message of dlq) await r.sqs.ack(message.ReceiptHandle!, DLQ_QUEUE);
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("90.00");
  });
  test("transient pre-commit error retries with visibility backoff then commits once", async () => {
    const w = await open();
    const p = input(w);
    let faults = 0;
    const faulty = new ProcessWager(new PgStore(r.orm), r.telemetry, {
      async beforeCommit() {
        if (faults++ === 0)
          throw Object.assign(new Error("injected connection reset"), { code: "ECONNRESET" });
      },
    });
    const consumer = new WagerConsumer(r.sqs, faulty, r.telemetry);
    await enqueue(p);
    await consumer.tick();
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("100.00");
    await Bun.sleep(1100);
    await consumer.tick();
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("90.00");
  }, 15000);
  test("permanent malformed message routes directly to DLQ", async () => {
    await r.sqs.send(INPUT_QUEUE, '{"type":"invalid"}', "invalid", crypto.randomUUID());
    await r.consumer.tick();
    const dlq = await r.sqs.receive(DLQ_QUEUE, 0);
    expect(dlq.length).toBe(1);
    await r.sqs.ack(dlq[0]!.ReceiptHandle!, DLQ_QUEUE);
  });
  test("retry budget exhausted: FAILED audit + DLQ, no debit", async () => {
    const w = await open();
    const p = input(w);
    let faults = 0;
    const faulty = new ProcessWager(new PgStore(r.orm), r.telemetry, {
      async beforeCommit() {
        if (faults++ < 5)
          throw Object.assign(new Error("injected connection reset"), { code: "ECONNRESET" });
      },
    });
    const consumer = new WagerConsumer(r.sqs, faulty, r.telemetry);
    await enqueue(p);
    for (let i = 0; i < 5; i++) {
      const [message] = await r.sqs.receive();
      expect(message).toBeDefined();
      await consumer.handle(message!);
      if (i < 4) {
        await r.sqs.visibility(message!.ReceiptHandle!, 0);
      }
    }
    expect((await r.queries.external(p.providerId, p.externalTransactionId)).status).toBe("FAILED");
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("100.00");
    const dlq = await r.sqs.receive(DLQ_QUEUE, 0);
    expect(dlq.length).toBe(1);
    await r.sqs.ack(dlq[0]!.ReceiptHandle!, DLQ_QUEUE);
  }, 15000);
  test("REFUND/ROLLBACK arrive via SQS before BET; persistent reference worker recovers; absent expires", async () => {
    for (const kind of ["REFUND", "ROLLBACK"] as const) {
      const w = await open();
      const bet = input(w, "BET", "20.00");
      const reversal = input(w, kind, "20.00", bet.externalTransactionId);
      await enqueue(reversal);
      await r.consumer.tick();
      expect(
        (await r.queries.external(reversal.providerId, reversal.externalTransactionId)).status,
      ).toBe("PENDING_REFERENCE");
      await enqueue(bet);
      await r.consumer.tick();
      await Bun.sleep(70);
      await r.references.tick();
      expect(
        (await r.queries.external(reversal.providerId, reversal.externalTransactionId)).status,
      ).toBe("PROCESSED");
      expect((await r.queries.wallet(w.id)).balance.amount).toBe("100.00");
    }
    const w = await open();
    const absent = input(w, "REFUND", "1.00", crypto.randomUUID());
    const tx = await execute(absent);
    for (let i = 0; i < 3; i++) {
      await sql("UPDATE wager_transactions SET next_attempt_at=now() WHERE id=?", [
        tx.transactionId,
      ]);
      await r.references.tick();
    }
    expect((await r.queries.transaction(tx.transactionId)).failureCode).toBe("REFERENCE_NOT_FOUND");
    expect(
      (
        await sql(
          "SELECT id FROM outbox WHERE event_type='WagerTransactionRejected' AND payload->'data'->>'transactionId'=?",
          [tx.transactionId],
        )
      ).length,
    ).toBe(1);
  }, 15000);
  test("two publisher processes drain committed outbox, persistent event IDs and versions", async () => {
    for (let i = 0; i < 12; i++) await open();
    const start = String(Date.now() + 800);
    const one = child("tests/fixtures/publisher.ts", { PUBLISH_START_AT: start });
    const two = child("tests/fixtures/publisher.ts", { PUBLISH_START_AT: start });
    expect(await one.proc.exited).toBe(0);
    expect(await two.proc.exited).toBe(0);
    const stats = await Promise.all(
      [one, two].map(
        async (c) =>
          JSON.parse((await Bun.file(c.path).text()).trim().split("\n").at(-1)!) as {
            publisherPid: number;
            published: number;
          },
      ),
    );
    expect(stats.every((s) => s.published > 0)).toBe(true);
    expect(new Set(stats.map((s) => s.publisherPid)).size).toBe(2);
    console.log(JSON.stringify({ event: "publisher_concurrency_evidence", publishers: stats }));
    expect((await sql("SELECT id FROM outbox WHERE published_at IS NULL")).length).toBe(0);
    const rows = await sql<{ id: string; payload: { eventId: string; version: number } }>(
      "SELECT id,payload FROM outbox",
    );
    for (const row of rows) {
      expect(row.payload.eventId).toBe(row.id);
      expect(row.payload.version).toBe(1);
    }
    const events = await r.sqs.receive(EVENTS_QUEUE, 0);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) await r.sqs.ack(event.ReceiptHandle!, EVENTS_QUEUE);
  }, 30000);
  test("publisher death after send before mark: expired lease recovers same event ID", async () => {
    await open();
    const c = child("tests/fixtures/crash-publisher.ts");
    await waitFor(async () => (await Bun.file(c.path).text()).includes("SENT_BEFORE_MARK:"));
    const log = await Bun.file(c.path).text();
    const id = /SENT_BEFORE_MARK:([a-f0-9-]+)/.exec(log)![1]!;
    await stop(c.proc, "SIGKILL");
    expect(
      (await sql("SELECT id FROM outbox WHERE id=? AND published_at IS NULL", [id])).length,
    ).toBe(1);
    await Bun.sleep(1200);
    await r.publisher.tick();
    expect(
      (await sql("SELECT id FROM outbox WHERE id=? AND published_at IS NOT NULL", [id])).length,
    ).toBe(1);
  }, 15000);
  test("publisher send failure schedules persisted backoff and recovery", async () => {
    const w = await open();
    const badSqs = Object.create(r.sqs) as typeof r.sqs;
    badSqs.send = async () => {
      throw new Error("injected SQS disconnect");
    };
    const bad = new OutboxPublisher(r.orm, badSqs, r.telemetry);
    await waitFor(async () => {
      await bad.tick();
      const scheduled = await sql<{ attempts: number }>(
        "SELECT attempts FROM outbox WHERE aggregate_id=? AND published_at IS NULL",
        [w.id],
      );
      return scheduled.length === 2 && scheduled.every((row) => row.attempts === 1);
    });
    const rows = await sql<{ attempts: number }>(
      "SELECT attempts FROM outbox WHERE aggregate_id=? AND published_at IS NULL",
      [w.id],
    );
    expect(rows.length).toBe(2);
    expect(rows.every((x) => x.attempts === 1)).toBe(true);
    await waitFor(async () => {
      await r.publisher.tick();
      return (
        (await sql("SELECT id FROM outbox WHERE aggregate_id=? AND published_at IS NULL", [w.id]))
          .length === 0
      );
    });
    expect(
      (await sql("SELECT id FROM outbox WHERE aggregate_id=? AND published_at IS NULL", [w.id]))
        .length,
    ).toBe(0);
  });
});

describe("failure boundaries and recovery", () => {
  test("uncommitted events are invisible to publisher; rollback leaves no event", async () => {
    const w = await open();
    await waitFor(async () => {
      await r.publisher.tick();
      return (await sql("SELECT id FROM outbox WHERE published_at IS NULL")).length === 0;
    });
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const atCommit = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const faulty = new ProcessWager(new PgStore(r.orm), r.telemetry, {
      async beforeCommit() {
        reached();
        await gate;
        throw new Error("ROLLBACK_AFTER_OBSERVATION");
      },
    });
    const p = input(w);
    const pending = faulty
      .execute(p, p.externalTransactionId, { correlationId: "no-premature-event" })
      .catch((error) => error);
    await atCommit;
    try {
      expect(await r.publisher.tick()).toBe(0);
      expect((await r.queries.wallet(w.id)).balance.amount).toBe("100.00");
    } finally {
      release();
    }
    expect(await pending).toBeInstanceOf(Error);
    expect(
      (
        await sql(
          "SELECT id FROM outbox WHERE payload->'data'->>'transactionId' IN (SELECT id::text FROM wager_transactions WHERE external_id=?)",
          [p.externalTransactionId],
        )
      ).length,
    ).toBe(0);
  });
  test("row lock timeout retries transaction and records conflict metric", async () => {
    const w = await open();
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const hold = r.orm.em.fork().transactional(async (em) => {
      await new PgUnit(em).lockWallet(w.id);
      reached();
      await gate;
    });
    await acquired;
    const before = (await r.telemetry.locks.get()).values[0]?.value ?? 0;
    const p = input(w);
    const result = execute(p);
    try {
      await waitFor(
        async () => ((await r.telemetry.locks.get()).values[0]?.value ?? 0) > before,
        6000,
      );
    } finally {
      release();
      await hold;
    }
    expect((await result).status).toBe("PROCESSED");
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("90.00");
  }, 15000);
  test("permanent database failure is audited and sent to DLQ immediately", async () => {
    const w = await open();
    const p = input(w);
    let attempts = 0;
    const faulty = new ProcessWager(new PgStore(r.orm), r.telemetry, {
      async beforeCommit() {
        if (attempts++ === 0)
          throw Object.assign(new Error("injected permanent SQL error"), { code: "23514" });
      },
    });
    const consumer = new WagerConsumer(r.sqs, faulty, r.telemetry);
    await enqueue(p);
    await consumer.tick();
    const tx = await r.queries.external(p.providerId, p.externalTransactionId);
    expect(tx.status).toBe("FAILED");
    expect(tx.failureCode).toBe("INFRASTRUCTURE_PERMANENT_FAILURE");
    const dlq = await r.sqs.receive(DLQ_QUEUE, 0);
    expect(dlq.length).toBe(1);
    await r.sqs.ack(dlq[0]!.ReceiptHandle!, DLQ_QUEUE);
  });
  test("unavailable SQS: live stays 200, ready is 503", async () => {
    const server = child("src/main.ts", { PORT: "3214", SQS_ENDPOINT: "http://127.0.0.1:1" });
    try {
      await waitFor(async () => {
        try {
          return (await fetch("http://127.0.0.1:3214/health/live")).ok;
        } catch {
          return false;
        }
      });
      const ready = await fetch("http://127.0.0.1:3214/health/ready");
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({ code: "INFRASTRUCTURE_UNAVAILABLE", retryable: true });
    } finally {
      await stop(server.proc);
    }
  }, 15000);
  test("SIGTERM drains in-flight committed message before exiting", async () => {
    const w = await open();
    const p = input(w);
    await enqueue(p);
    const c = child("tests/fixtures/graceful-consumer.ts");
    await waitFor(async () =>
      (await Bun.file(c.path).text()).includes("DRAINING_COMMITTED_MESSAGE"),
    );
    await stop(c.proc, "SIGTERM");
    expect(c.proc.exitCode).toBe(0);
    expect((await Bun.file(c.path).text()).includes("DRAINED_AND_ACKED")).toBe(true);
    await Bun.sleep(2100);
    expect((await r.sqs.receive(INPUT_QUEUE, 0)).length).toBe(0);
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("90.00");
  }, 15000);
  test("PostgreSQL outage returns 503 without killing liveness; reconnect after container restart", async () => {
    const w = await open();
    const p = input(w);
    const server = child("src/main.ts", { PORT: "3215" });
    const docker = async (args: string[]) => {
      const proc = Bun.spawn(["docker", "compose", ...args], { stdout: "ignore", stderr: "pipe" });
      const code = await proc.exited;
      if (code !== 0) throw new Error(await new Response(proc.stderr).text());
    };
    try {
      await waitFor(async () => {
        try {
          return (await fetch("http://127.0.0.1:3215/health/ready")).ok;
        } catch {
          return false;
        }
      });
      await docker(["stop", "postgres"]);
      expect((await fetch("http://127.0.0.1:3215/health/live")).status).toBe(200);
      const res = await fetch("http://127.0.0.1:3215/wagering/transactions", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": p.externalTransactionId },
        body: JSON.stringify(p),
      });
      expect(res.status).toBe(503);
      expect((await fetch("http://127.0.0.1:3215/health/ready")).status).toBe(503);
    } finally {
      await docker(["start", "postgres"]);
      await stop(server.proc);
    }
    await waitFor(async () => {
      try {
        await sql("SELECT 1");
        return true;
      } catch {
        return false;
      }
    });
    expect((await execute(p)).status).toBe("PROCESSED");
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("90.00");
  }, 30000);
});

describe("critical review regressions", () => {
  async function lastDelivery(p: WagerInput) {
    await enqueue(p);
    for (let i = 0; i < 4; i++) {
      const [message] = await r.sqs.receive();
      if (!message?.ReceiptHandle) throw new Error("Expected real SQS delivery");
      await r.sqs.visibility(message.ReceiptHandle, 0);
    }
    const [message] = await r.sqs.receive();
    expect(message?.Attributes?.ApproximateReceiveCount).toBe("5");
    return message!;
  }
  test("ACK failure at last delivery must not DLQ an already committed wager", async () => {
    const w = await open();
    const p = input(w);
    const message = await lastDelivery(p);
    const flaky = Object.create(r.sqs) as typeof r.sqs;
    let ackCalls = 0;
    flaky.ack = async (receipt, name) => {
      if (ackCalls++ === 0)
        throw Object.assign(new Error("injected ACK connection reset"), { code: "ECONNRESET" });
      await r.sqs.ack(receipt, name);
    };
    await new WagerConsumer(flaky, r.processor, r.telemetry).handle(message);
    const dlq = await r.sqs.receive(DLQ_QUEUE, 0);
    for (const row of dlq) await r.sqs.ack(row.ReceiptHandle!, DLQ_QUEUE);
    expect(dlq.length).toBe(0);
    expect((await r.queries.external(p.providerId, p.externalTransactionId)).status).toBe(
      "PROCESSED",
    );
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("90.00");
  });
  test("uncertain COMMIT at delivery limit resolves replay instead of DLQ", async () => {
    const w = await open();
    const p = input(w);
    const message = await lastDelivery(p);
    const store = new PgStore(r.orm);
    let fail = true;
    const processor = new ProcessWager(
      {
        async atomic(work) {
          const result = await store.atomic(work);
          if (fail) {
            fail = false;
            throw Object.assign(new Error("COMMIT response lost"), { code: "ECONNRESET" });
          }
          return result;
        },
      },
      r.telemetry,
    );
    await new WagerConsumer(r.sqs, processor, r.telemetry).handle(message);
    const dlq = await r.sqs.receive(DLQ_QUEUE, 0);
    for (const row of dlq) await r.sqs.ack(row.ReceiptHandle!, DLQ_QUEUE);
    expect(dlq.length).toBe(0);
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("90.00");
    expect(
      (await sql("SELECT id FROM wallet_ledger WHERE wallet_id=? AND direction='DEBIT'", [w.id]))
        .length,
    ).toBe(1);
  });
  test("busy reference wallet cannot starve an independent wallet behind 26 candidates", async () => {
    const busy = await open();
    const free = await open();
    for (let i = 0; i < 26; i++) await execute(input(busy, "REFUND", "1.00", crypto.randomUUID()));
    const bet = input(free, "BET", "1.00");
    const pending = await execute(input(free, "REFUND", "1.00", bet.externalTransactionId));
    await execute(bet);
    await sql(
      "UPDATE wager_transactions SET next_attempt_at='2000-01-01' WHERE wallet_id=? AND status='PENDING_REFERENCE'",
      [busy.id],
    );
    await sql("UPDATE wager_transactions SET next_attempt_at='2001-01-01' WHERE id=?", [
      pending.transactionId,
    ]);
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = r.orm.em.fork().transactional(async (em) => {
      await new PgUnit(em).lockWallet(busy.id);
      locked();
      await gate;
    });
    await acquired;
    try {
      await r.references.tick();
      expect((await r.queries.transaction(pending.transactionId)).status).toBe("PROCESSED");
    } finally {
      release();
      await hold;
    }
  }, 10000);
  test("expired reference TTL cannot be revived by a late arriving BET", async () => {
    const w = await open();
    const bet = input(w, "BET", "10.00");
    const pending = await execute(input(w, "REFUND", "10.00", bet.externalTransactionId));
    await sql(
      "UPDATE wager_transactions SET created_at=now()-interval '25 hours',next_attempt_at=now()-interval '1 second' WHERE id=?",
      [pending.transactionId],
    );
    await execute(bet);
    await r.processor.retryReference(pending.transactionId);
    expect((await r.queries.transaction(pending.transactionId)).failureCode).toBe(
      "REFERENCE_NOT_FOUND",
    );
    expect((await r.queries.wallet(w.id)).balance.amount).toBe("90.00");
  });
  test("publisher that loses its lease must not send the remaining batch", async () => {
    await waitFor(async () => {
      await r.publisher.tick();
      return (await sql("SELECT id FROM outbox WHERE published_at IS NULL")).length === 0;
    });
    for (let i = 0; i < 3; i++) await open();
    let sent = 0;
    const observer = Object.create(r.sqs) as typeof r.sqs;
    observer.send = async (...args) => {
      sent++;
      await r.sqs.send(...args);
    };
    let transferred = false;
    const stale = new OutboxPublisher(r.orm, observer, r.telemetry, {
      async afterSendBeforeMark() {
        if (transferred) return;
        transferred = true;
        await sql(
          "UPDATE outbox SET lease_until=now()-interval '1 second' WHERE published_at IS NULL",
        );
        await r.publisher.tick();
      },
    });
    await waitFor(async () => {
      await stale.tick();
      return transferred;
    });
    expect(sent).toBe(1);
    expect((await sql("SELECT id FROM outbox WHERE published_at IS NULL")).length).toBe(0);
  });
  test("malformed JSON is a validation error, not a transient 503", async () => {
    const server = child("src/main.ts", { PORT: "3216" });
    try {
      await waitFor(async () => {
        try {
          return (await fetch("http://127.0.0.1:3216/health/live")).ok;
        } catch {
          return false;
        }
      });
      const response = await fetch("http://127.0.0.1:3216/wagering/transactions", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "invalid-json" },
        body: '{"kind":',
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { retryable: boolean }).retryable).toBe(false);
    } finally {
      await stop(server.proc);
    }
  });
});

test("critical review: FAILED commit before DLQ send resumes dead-letter delivery on redelivery", async () => {
  const w = await open();
  const p = input(w);
  const envelope = await enqueue(p);
  const [first] = await r.sqs.receive();
  expect(first).toBeDefined();
  await r.processor.execute(
    p,
    p.externalTransactionId,
    { correlationId: envelope.messageId, messageId: envelope.messageId },
    "INFRASTRUCTURE_PERMANENT_FAILURE",
  );
  // Crash window: the audit/inbox committed, but no SendMessage to DLQ or DeleteMessage occurred.
  await r.sqs.visibility(first!.ReceiptHandle!, 0);
  await r.consumer.tick();
  const dlq = await r.sqs.receive(DLQ_QUEUE, 0);
  for (const message of dlq) await r.sqs.ack(message.ReceiptHandle!, DLQ_QUEUE);
  expect(dlq.length).toBe(1);
  expect((await r.queries.external(p.providerId, p.externalTransactionId)).status).toBe("FAILED");
  expect((await r.queries.wallet(w.id)).balance.amount).toBe("100.00");
});

test("critical review: outbox mark failure persists retry without an invalid domain transition", async () => {
  await waitFor(async () => {
    await r.publisher.tick();
    return (await sql("SELECT id FROM outbox WHERE published_at IS NULL")).length === 0;
  });
  const w = await open();
  // A real PostgreSQL error precisely after SQS SendMessage succeeded.
  await sql(`CREATE FUNCTION test_reject_publish_mark() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.aggregate_id='${w.id}'::uuid AND NEW.published_at IS NOT NULL THEN RAISE EXCEPTION 'INJECTED_MARK_FAILURE' USING ERRCODE='55P03'; END IF;
    RETURN NEW; END $$`);
  await sql(
    "CREATE TRIGGER test_publish_mark BEFORE UPDATE ON outbox FOR EACH ROW EXECUTE FUNCTION test_reject_publish_mark()",
  );
  try {
    await waitFor(async () => {
      await r.publisher.tick();
      const rows = await sql<{ attempts: number }>(
        "SELECT attempts FROM outbox WHERE aggregate_id=?",
        [w.id],
      );
      return rows.length === 2 && rows.every((row) => row.attempts === 1);
    });
  } finally {
    await sql("DROP TRIGGER test_publish_mark ON outbox");
    await sql("DROP FUNCTION test_reject_publish_mark()");
  }
  await waitFor(async () => {
    await r.publisher.tick();
    return (
      (await sql("SELECT id FROM outbox WHERE aggregate_id=? AND published_at IS NULL", [w.id]))
        .length === 0
    );
  });
});

test("critical review: conflicting key across wallets waits for winner then returns 409", async () => {
  const a = await open();
  const b = await open();
  const key = crypto.randomUUID();
  const pa = input(a);
  const pb = input(b);
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const acquired = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const first = new ProcessWager(new PgStore(r.orm), r.telemetry, {
    async beforeCommit() {
      reached();
      await gate;
    },
  });
  const winning = first.execute(pa, key, { correlationId: "key-race" });
  await acquired;
  const losing = execute(pb, key).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  try {
    await Bun.sleep(100);
  } finally {
    release();
  }
  expect((await winning).status).toBe("PROCESSED");
  expect(await losing).toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT", httpStatus: 409 } });
  expect((await r.queries.wallet(a.id)).balance.amount).toBe("90.00");
  expect((await r.queries.wallet(b.id)).balance.amount).toBe("100.00");
  expect(
    (await sql("SELECT id FROM wager_transactions WHERE external_id=?", [pb.externalTransactionId]))
      .length,
  ).toBe(0);
});

test("critical review: concurrent alias conflict and 50 new aliases preserve one decision", async () => {
  const w = await open();
  const p = input(w);
  const results = await Promise.all(
    Array.from({ length: 50 }, () => execute(p, crypto.randomUUID())),
  );
  expect(new Set(results.map((row) => row.transactionId)).size).toBe(1);
  expect((await r.queries.wallet(w.id)).balance.amount).toBe("90.00");
  expect(
    (
      await sql("SELECT key FROM idempotency_keys WHERE transaction_id=?", [
        results[0]!.transactionId,
      ])
    ).length,
  ).toBe(50);
  const second = await open();
  const q = input(second);
  await execute(q);
  const alias = crypto.randomUUID();
  const races = await Promise.allSettled([execute(p, alias), execute(q, alias)]);
  expect(races.filter((row) => row.status === "fulfilled").length).toBe(1);
  const failure = races.find((row) => row.status === "rejected");
  expect(failure).toMatchObject({ status: "rejected", reason: { code: "IDEMPOTENCY_CONFLICT" } });
  expect((await r.queries.wallet(second.id)).balance.amount).toBe("90.00");
});

test("critical review: incremental migration down/up preserves existing financial history", async () => {
  const w = await open();
  const p = input(w);
  const original = await execute(p);
  await r.orm.migrator.down();
  expect(
    (await sql("SELECT indexname FROM pg_indexes WHERE indexname='reference_due_by_wallet'"))
      .length,
  ).toBe(0);
  expect((await r.queries.wallet(w.id)).balance.amount).toBe("90.00");
  await r.orm.migrator.up();
  expect(
    (await sql("SELECT indexname FROM pg_indexes WHERE indexname='reference_due_by_wallet'"))
      .length,
  ).toBe(1);
  expect((await execute(p)).balance).toEqual(original.balance);
});

test("critical review: UUID case is normalized for wallet identity, replay hash and ledger cursor", async () => {
  const playerId = crypto.randomUUID().toUpperCase();
  const w = await r.processor.open({
    playerId,
    initialBalance: { amount: "100.00", currency: "BRL" },
  });
  const p = { ...input(w), playerId: playerId.toUpperCase(), walletId: w.id.toUpperCase() };
  const first = await execute(p);
  expect(first.status).toBe("PROCESSED");
  const replay = await execute({
    ...p,
    playerId: playerId.toLowerCase(),
    walletId: w.id.toLowerCase(),
  });
  expect(replay.transactionId).toBe(first.transactionId);
  expect(replay.idempotentReplay).toBe(true);
  await execute(input({ ...w, playerId: playerId.toLowerCase() }, "WIN", "1.00"));
  const page = await r.queries.ledger(w.id.toUpperCase(), undefined, "2");
  expect(page.nextCursor).not.toBeNull();
  const next = await r.queries.ledger(w.id.toUpperCase(), page.nextCursor!, "2");
  expect(next.items.length).toBe(1);
  const oldCursor = JSON.parse(Buffer.from(page.nextCursor!, "base64url").toString()) as {
    walletId: string;
  };
  oldCursor.walletId = oldCursor.walletId.toUpperCase();
  const legacyCursor = Buffer.from(JSON.stringify(oldCursor)).toString("base64url");
  expect((await r.queries.ledger(w.id, legacyCursor, "2")).items.length).toBe(1);
});

test("critical review: UUID normalization preserves legacy HTTP/inbox hashes and terminal result", async () => {
  const w = await open();
  const legacyInput = {
    ...input(w),
    walletId: w.id.toUpperCase(),
    playerId: w.playerId.toUpperCase(),
  };
  const key = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const legacy = WagerTransaction.create(legacyInput, key, payloadHash(legacyInput), "legacy");
  await new PgStore(r.orm).atomic(async (unit) => {
    const wallet = await unit.lockWallet(w.id);
    legacy.apply(wallet, undefined, false, 3, 50); // Historical version rejected the upper-case owner.
    expect(legacy.status).toBe("REJECTED");
    await unit.saveTransaction(legacy);
    await unit.bindKey(key, legacy);
    await unit.enqueue(OutboxMessage.enqueue(WagerTransactionRejected.from(legacy)));
    const inbox = await unit.receiveInbox(
      InboxMessage.receive({
        consumerName: "wager-consumer-v1",
        messageId,
        payloadHash: hashValue({ hash: legacy.snapshot.payloadHash, key }),
      }),
    );
    inbox.markProcessed(legacy.id);
    await unit.saveInbox(inbox);
  });
  const normalized = { ...legacyInput, walletId: w.id, playerId: w.playerId };
  for (const body of [legacyInput, normalized]) {
    const http = await execute(body, key);
    expect(http).toEqual(legacy.response(true));
    const sqs = await r.processor.execute(body, key, { correlationId: messageId, messageId });
    expect(sqs).toEqual(legacy.response(true));
  }
  await expect(
    r.processor.execute({ ...normalized, money: { amount: "11.00", currency: "BRL" } }, key, {
      correlationId: messageId,
      messageId,
    }),
  ).rejects.toMatchObject({ code: "INBOX_CONFLICT" });
  expect(
    (
      await sql<{ payload_hash: string }>(
        "SELECT payload_hash FROM wager_transactions WHERE id=?",
        [legacy.id],
      )
    )[0]!.payload_hash,
  ).toBe(legacy.snapshot.payloadHash);
});

test("dashboard: exact currency totals, scoped microsecond cursor, filters and read-only queries", async () => {
  const wallets = await Promise.all(
    ["99999999999999.99", "99999999999999.99", "0.00"].map((amount) =>
      r.processor.open({
        playerId: crypto.randomUUID(),
        initialBalance: { amount, currency: "USD" },
      }),
    ),
  );
  const ids = wallets.map((w) => w.id);
  // Equal timestamp including microseconds must page using the UUID tie-breaker without losing rows.
  for (const id of ids)
    await sql("UPDATE wallets SET created_at='2026-11-16 01:02:03.123456+00' WHERE id=?", [id]);
  const before = await sql("SELECT id,balance,version FROM wallets ORDER BY id");
  const summary = await r.dashboard.overview({ currency: "USD", days: "7" });
  expect(summary.balance).toEqual({ amount: "199999999999999.98", currency: "USD" });
  expect(summary.wallets).toBe(3);
  expect(summary.transactions).toBe(0); // OPENING belongs in history but not wagering activity.
  expect(summary.activity.length).toBe(7);
  expect(summary.activity.every((d) => d.total === 0)).toBe(true);
  let cursor: string | null = null;
  const found: string[] = [];
  do {
    const page = await r.dashboard.list("wallets", {
      currency: "USD",
      limit: "1",
      ...(cursor ? { cursor } : {}),
    });
    found.push(...page.items.map((w) => ("id" in w ? (w.id ?? "") : "")));
    if (!cursor && page.nextCursor)
      await expect(
        r.dashboard.list("wallets", { currency: "BRL", cursor: page.nextCursor }),
      ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    if (!cursor && page.nextCursor) {
      const malformed = JSON.parse(Buffer.from(page.nextCursor, "base64url").toString());
      malformed.at = "2026-02-31 01:02:03.123456+00";
      await expect(
        r.dashboard.list("wallets", {
          currency: "USD",
          cursor: Buffer.from(JSON.stringify(malformed)).toString("base64url"),
        }),
      ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    }
    cursor = page.nextCursor;
  } while (cursor);
  expect(found.sort()).toEqual(ids.sort());
  expect(
    (await r.dashboard.list("wallets", { currency: "USD", query: wallets[0]!.playerId })).items
      .length,
  ).toBe(1);
  expect(
    (
      await r.dashboard.list("transactions", {
        currency: "USD",
        walletId: wallets[0]!.id,
        kind: "OPENING",
        status: "PROCESSED",
      })
    ).items.length,
  ).toBe(1);
  expect((await r.dashboard.list("transactions", { query: "' OR 1=1 --" })).items.length).toBe(0);
  expect((await r.dashboard.list("transactions", { query: "%" })).items.length).toBe(0);
  await expect(r.dashboard.list("wallets", { cursor: "invalid" })).rejects.toMatchObject({
    code: "INVALID_CURSOR",
  });
  await expect(r.dashboard.list("wallets", { status: "PROCESSED" })).rejects.toMatchObject({
    code: "INVALID_PAYLOAD",
  });
  expect(await sql("SELECT id,balance,version FROM wallets ORDER BY id")).toEqual(before);
  const p = { ...input(wallets[0]!, "BET", "0.01"), money: { amount: "0.01", currency: "USD" } };
  await execute(p);
  const updated = await r.dashboard.overview({ currency: "USD" });
  expect(updated.balance.amount).toBe("199999999999999.97");
  expect(updated.processed).toBe(1);
  expect(updated.transactions).toBe(1);
  expect(updated.activity.reduce((sum, d) => sum + d.total, 0)).toBe(1);
  expect((await r.dashboard.operations()).inbox).toBeGreaterThanOrEqual(0);
});

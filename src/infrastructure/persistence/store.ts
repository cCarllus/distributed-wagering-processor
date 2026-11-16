import { LockMode } from "@mikro-orm/core";
import type { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import type { FinancialStore, FinancialUnit } from "../../application/ports";
import { InboxMessage, OutboxMessage } from "../../domain/messages";
import { Money } from "../../domain/money";
import { type WagerState, WagerTransaction } from "../../domain/wager";
import { Wallet, type WalletLedgerEntry } from "../../domain/wallet";
import { WalletRecord } from "./entities";
export interface TransactionRow {
  id: string;
  input: WagerState["input"];
  idempotency_key: string;
  payload_hash: string;
  status: WagerState["status"];
  reference_id: string | null;
  failure_code: string | null;
  result_balance: string | null;
  result_currency: string | null;
  created_at: Date;
  processed_at: Date | null;
  reference_attempts: number;
  next_attempt_at: Date;
  correlation_id: string;
  causation_id: string | null;
}
export function transactionFrom(row: TransactionRow): WagerTransaction {
  return WagerTransaction.rehydrate({
    id: row.id,
    input: row.input,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash,
    status: row.status,
    referenceTransactionId: row.reference_id ?? undefined,
    failureCode: row.failure_code ?? undefined,
    resultBalance:
      row.result_balance === null
        ? undefined
        : Money.rehydrate(row.result_balance, row.result_currency!),
    createdAt: new Date(row.created_at),
    processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
    referenceAttempts: row.reference_attempts,
    nextAttemptAt: new Date(row.next_attempt_at),
    correlationId: row.correlation_id,
    causationId: row.causation_id ?? undefined,
  });
}
export function walletFrom(row: WalletRecord): Wallet {
  return Wallet.rehydrate({
    id: row.id,
    playerId: row.playerId,
    balance: Money.rehydrate(row.balance, row.currency),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
export class PgUnit implements FinancialUnit {
  constructor(readonly em: EntityManager) {}
  async sql<T>(query: string, params: unknown[] = []): Promise<T[]> {
    return this.em
      .getConnection()
      .execute<T[]>(query, params, "all", this.em.getTransactionContext());
  }
  async lockWallet(id: string): Promise<Wallet | undefined> {
    const row = await this.em.findOne(
      WalletRecord,
      { id },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    );
    return row ? walletFrom(row) : undefined;
  }
  async claimDueReference(): Promise<
    { transaction: WagerTransaction; wallet: Wallet } | undefined
  > {
    // Claim the wallet and choose a due reference in the SAME transaction. LIMIT
    // applies after SKIP LOCKED, so 26 busy references cannot hide another wallet.
    const [row] = await this.sql<{
      id: string;
      wallet_id: string;
    }>(`SELECT due.id, w.id AS wallet_id
      FROM wallets w JOIN LATERAL (
        SELECT id,next_attempt_at FROM wager_transactions
        WHERE wallet_id=w.id AND status='PENDING_REFERENCE' AND next_attempt_at<=clock_timestamp()
        ORDER BY next_attempt_at,id LIMIT 1
      ) due ON true
      ORDER BY due.next_attempt_at,due.id LIMIT 1 FOR UPDATE OF w SKIP LOCKED`);
    if (!row) return undefined;
    const wallet = await this.lockWallet(row.wallet_id);
    const transaction = await this.byId(row.id);
    if (!wallet || !transaction) throw new Error("CLAIMED_REFERENCE_DISAPPEARED");
    return { wallet, transaction };
  }
  async insertWallet(wallet: Wallet): Promise<void> {
    const s = wallet.snapshot;
    const row = this.em.create(WalletRecord, {
      id: s.id,
      playerId: s.playerId,
      currency: s.balance.currency,
      balance: s.balance.toCents(),
      version: s.version,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    });
    this.em.persist(row);
    await this.em.flush();
  }
  async saveWallet(wallet: Wallet): Promise<void> {
    const row = await this.em.findOneOrFail(WalletRecord, { id: wallet.id });
    row.balance = wallet.balance.toCents();
    row.version = wallet.version;
    row.updatedAt = wallet.snapshot.updatedAt;
    await this.em.flush();
  }
  private async find(query: string, params: unknown[]): Promise<WagerTransaction | undefined> {
    const rows = await this.sql<TransactionRow>(query, params);
    return rows[0] ? transactionFrom(rows[0]) : undefined;
  }
  byId(id: string) {
    return this.find("SELECT * FROM wager_transactions WHERE id=?", [id]);
  }
  byKey(key: string) {
    return this.find(
      "SELECT t.* FROM wager_transactions t JOIN idempotency_keys k ON k.transaction_id=t.id WHERE k.key=?",
      [key],
    );
  }
  findTransaction(providerId: string, externalId: string) {
    return this.find("SELECT * FROM wager_transactions WHERE provider_id=? AND external_id=?", [
      providerId,
      externalId,
    ]);
  }
  async bindKey(key: string, tx: WagerTransaction): Promise<void> {
    await this.sql(
      "INSERT INTO idempotency_keys(key,transaction_id,payload_hash) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING",
      [key, tx.id, tx.snapshot.payloadHash],
    );
    const bound = await this.byKey(key);
    if (bound?.id !== tx.id) {
      const { ApplicationError } = await import("../../application/contracts");
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", 409);
    }
  }
  async saveTransaction(tx: WagerTransaction): Promise<void> {
    const s = tx.snapshot;
    const p = s.input;
    await this.sql(
      `INSERT INTO wager_transactions(id,provider_id,external_id,wallet_id,player_id,currency,amount,kind,status,reference_id,payload_hash,input,idempotency_key,failure_code,result_balance,result_currency,created_at,processed_at,reference_attempts,next_attempt_at,correlation_id,causation_id)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,reference_id=EXCLUDED.reference_id,failure_code=EXCLUDED.failure_code,result_balance=EXCLUDED.result_balance,result_currency=EXCLUDED.result_currency,processed_at=EXCLUDED.processed_at,reference_attempts=EXCLUDED.reference_attempts,next_attempt_at=EXCLUDED.next_attempt_at`,
      [
        s.id,
        p.providerId,
        p.externalTransactionId,
        p.walletId,
        p.playerId,
        p.money.currency,
        tx.money.toCents(),
        p.kind,
        s.status,
        s.referenceTransactionId ?? null,
        s.payloadHash,
        JSON.stringify(p),
        s.idempotencyKey,
        s.failureCode ?? null,
        s.resultBalance?.toCents() ?? null,
        s.resultBalance?.currency ?? null,
        s.createdAt,
        s.processedAt ?? null,
        s.referenceAttempts,
        s.nextAttemptAt,
        s.correlationId,
        s.causationId ?? null,
      ],
    );
  }
  async reversed(referenceId: string, kind: string): Promise<boolean> {
    return (
      (
        await this.sql(
          "SELECT id FROM wager_transactions WHERE reference_id=? AND kind=? AND status='PROCESSED'",
          [referenceId, kind],
        )
      ).length > 0
    );
  }
  async append(entry: WalletLedgerEntry): Promise<void> {
    const s = entry.snapshot;
    await this.sql(
      "INSERT INTO wallet_ledger(id,wallet_id,transaction_id,direction,amount,currency,balance_before,balance_after,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      [
        s.id,
        s.walletId,
        s.transactionId,
        s.direction,
        s.money.toCents(),
        s.money.currency,
        s.balanceBefore.toCents(),
        s.balanceAfter.toCents(),
        s.createdAt,
      ],
    );
  }
  async receiveInbox(message: InboxMessage): Promise<InboxMessage> {
    const s = message.snapshot;
    await this.sql(
      "INSERT INTO inbox(consumer_name,message_id,payload_hash,received_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
      [s.consumerName, s.messageId, s.payloadHash, s.receivedAt],
    );
    const [row] = await this.sql<{
      consumer_name: string;
      message_id: string;
      payload_hash: string;
      received_at: Date;
      processed_at: Date | null;
      transaction_id: string | null;
    }>("SELECT * FROM inbox WHERE consumer_name=? AND message_id=? FOR UPDATE", [
      s.consumerName,
      s.messageId,
    ]);
    return InboxMessage.rehydrate({
      consumerName: row!.consumer_name,
      messageId: row!.message_id,
      payloadHash: row!.payload_hash,
      receivedAt: new Date(row!.received_at),
      processedAt: row!.processed_at ? new Date(row!.processed_at) : undefined,
      transactionId: row!.transaction_id ?? undefined,
    });
  }
  async saveInbox(message: InboxMessage): Promise<void> {
    const s = message.snapshot;
    await this.sql(
      "UPDATE inbox SET processed_at=?,transaction_id=? WHERE consumer_name=? AND message_id=?",
      [s.processedAt, s.transactionId, s.consumerName, s.messageId],
    );
  }
  async enqueue(message: OutboxMessage): Promise<void> {
    const s = message.snapshot;
    await this.sql(
      "INSERT INTO outbox(id,aggregate_id,event_type,payload,occurred_at,attempts,next_attempt_at) VALUES(?,?,?,?,?,?,?)",
      [
        s.id,
        s.aggregateId,
        s.eventType,
        JSON.stringify(s.payload),
        s.occurredAt,
        s.attempts,
        s.nextAttemptAt,
      ],
    );
  }
}
export class PgStore implements FinancialStore {
  constructor(readonly orm: MikroORM) {}
  async atomic<T>(work: (unit: FinancialUnit) => Promise<T>): Promise<T> {
    return this.orm.em.fork().transactional(async (em) => {
      const unit = new PgUnit(em);
      await unit.sql("SET LOCAL lock_timeout='2s'");
      await unit.sql("SET LOCAL statement_timeout='5s'");
      return work(unit);
    });
  }
}

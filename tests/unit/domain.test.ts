import { describe, expect, test } from "bun:test";
import { ApplicationError, parse, payloadHash, wagerSchema } from "../../src/application/contracts";
import { WagerTransactionProcessed } from "../../src/domain/events";
import { InboxMessage, OutboxMessage } from "../../src/domain/messages";
import { Money } from "../../src/domain/money";
import { type WagerInput, WagerTransaction } from "../../src/domain/wager";
import { Wallet, WalletLedgerEntry } from "../../src/domain/wallet";

const money = (amount: string, currency = "BRL") => Money.from({ amount, currency });
function wallet(amount = "100.00") {
  return Wallet.open({
    id: crypto.randomUUID(),
    playerId: crypto.randomUUID(),
    initialBalance: money(amount),
  });
}
function transaction(
  w: Wallet,
  kind: WagerInput["kind"],
  amount: string,
  reference?: WagerTransaction,
  overrides: Partial<WagerInput> = {},
) {
  const p: WagerInput = {
    providerId: "provider",
    externalTransactionId: crypto.randomUUID(),
    playerId: w.playerId,
    walletId: w.id,
    roundId: "round",
    gameId: "game",
    kind,
    money: money(amount).toJSON(),
    referenceExternalTransactionId: reference?.input.externalTransactionId,
    ...overrides,
  };
  return WagerTransaction.create(p, crypto.randomUUID(), payloadHash(p), "unit");
}
describe("Money exact fixed scale", () => {
  test("bigint arithmetic, serialization and immutability", () => {
    const a = money("90071992547409.91");
    expect(a.add(money("0.01")).toString()).toBe("90071992547409.92");
    expect(a.toString()).toBe("90071992547409.91");
    expect(money("0.10").add(money("0.20")).toString()).toBe("0.30");
    expect(money("1.00").negate().toJSON()).toEqual({ amount: "-1.00", currency: "BRL" });
  });
  test.each([
    "",
    "NaN",
    "Infinity",
    "1e2",
    "1",
    "1.0",
    "1.001",
    "-1.00",
    "+1.00",
    "01.00",
    " 1.00",
    "100000000000000.00",
  ])("rejects %s without rounding", (v) => expect(() => money(v)).toThrow());
  test("currency and range", () => {
    expect(() => money("1.00").add(money("1.00", "USD"))).toThrow("CURRENCY_MISMATCH");
    expect(() => money("1.00", "XYZ")).toThrow();
    expect(() => money("99999999999999.99").add(money("0.01"))).toThrow("BALANCE_LIMIT_EXCEEDED");
  });
});
describe("Wallet and wagering invariants", () => {
  test("BET/WIN/LOSS and terminal protection", () => {
    const w = wallet();
    const bet = transaction(w, "BET", "80.00");
    expect(bet.apply(w, undefined, false, 3, 1)?.isBalanced()).toBe(true);
    expect(w.balance.toString()).toBe("20.00");
    expect(w.version).toBe(2);
    const win = transaction(w, "WIN", "10.00", bet);
    win.apply(w, bet, false, 3, 1);
    const loss = transaction(w, "LOSS", "0.00");
    expect(loss.apply(w, undefined, false, 3, 1)).toBeUndefined();
    expect(w.version).toBe(3);
    expect(w.balance.toString()).toBe("30.00");
    expect(() => loss.reject("X")).toThrow("INVALID_TRANSACTION_STATE");
    expect(() => bet.apply(w, undefined, false, 3, 1)).toThrow();
  });
  test("insufficient BET leaves wallet unchanged", () => {
    const w = wallet();
    const tx = transaction(w, "BET", "101.00");
    expect(tx.apply(w, undefined, false, 3, 1)).toBeUndefined();
    expect(tx.response().failureCode).toBe("INSUFFICIENT_FUNDS");
    expect(w.version).toBe(1);
  });
  test("refund, rollback and duplicate reversal", () => {
    const w = wallet();
    const bet = transaction(w, "BET", "80.00");
    bet.apply(w, undefined, false, 3, 1);
    const refund = transaction(w, "REFUND", "80.00", bet);
    refund.apply(w, bet, false, 3, 1);
    expect(w.balance.toString()).toBe("100.00");
    const dup = transaction(w, "REFUND", "80.00", bet);
    dup.apply(w, bet, true, 3, 1);
    expect(dup.response().failureCode).toBe("ALREADY_REVERSED");
    const rb = transaction(w, "ROLLBACK", "80.00", refund);
    rb.apply(w, refund, false, 3, 1);
    expect(w.balance.toString()).toBe("20.00");
  });
  test("rollback credit cannot overdraw and has distinct code", () => {
    const w = wallet("0.00");
    const win = transaction(w, "WIN", "20.00");
    win.apply(w, undefined, false, 3, 1);
    transaction(w, "BET", "20.00").apply(w, undefined, false, 3, 1);
    const rb = transaction(w, "ROLLBACK", "20.00", win);
    rb.apply(w, win, false, 3, 1);
    expect(rb.response().failureCode).toBe("REVERSAL_INSUFFICIENT_FUNDS");
    expect(w.balance.toString()).toBe("0.00");
  });
  test("references enforce amount, scope and kind", () => {
    const w = wallet();
    const bet = transaction(w, "BET", "10.00");
    bet.apply(w, undefined, false, 3, 1);
    const partial = transaction(w, "REFUND", "5.00", bet);
    partial.apply(w, bet, false, 3, 1);
    expect(partial.response().failureCode).toBe("REVERSAL_AMOUNT_MISMATCH");
    const round = transaction(w, "REFUND", "10.00", bet, { roundId: "another" });
    round.apply(w, bet, false, 3, 1);
    expect(round.response().failureCode).toBe("REFERENCE_MISMATCH");
    const win = transaction(w, "WIN", "10.00");
    win.apply(w, undefined, false, 3, 1);
    const wrong = transaction(w, "REFUND", "10.00", win);
    wrong.apply(w, win, false, 3, 1);
    expect(wrong.response().failureCode).toBe("REFERENCE_KIND_INVALID");
  });
  test("pending reference backoff then terminal expiry", () => {
    const w = wallet();
    const tx = transaction(w, "REFUND", "10.00", undefined, {
      referenceExternalTransactionId: "future",
    });
    tx.apply(w, undefined, false, 2, 10);
    expect(tx.status).toBe("PENDING_REFERENCE");
    tx.apply(w, undefined, false, 2, 10);
    tx.apply(w, undefined, false, 2, 10);
    expect(tx.response().failureCode).toBe("REFERENCE_NOT_FOUND");
  });
  test("invalid kinds/scale/required reference/currency", () => {
    const w = wallet();
    expect(() => transaction(w, "REFUND", "1.00")).toThrow("REFERENCE_REQUIRED");
    expect(() => transaction(w, "LOSS", "1.00")).toThrow();
    expect(() => transaction(w, "BET", "0.00")).toThrow();
    const tx = transaction(w, "BET", "1.00", undefined, {
      money: { amount: "1.00", currency: "USD" },
    });
    tx.apply(w, undefined, false, 3, 1);
    expect(tx.response().failureCode).toBe("CURRENCY_MISMATCH");
    expect(() => parse(wagerSchema, { ...tx.input, kind: "OPENING" })).toThrow(ApplicationError);
  });
  test("rehydration preserves terminal state and original balance", () => {
    const w = wallet();
    const tx = transaction(w, "BET", "10.00");
    tx.apply(w, undefined, false, 3, 1);
    transaction(w, "WIN", "50.00").apply(w, undefined, false, 3, 1);
    const copy = WagerTransaction.rehydrate(tx.snapshot);
    expect(copy.response(true).balance?.amount).toBe("90.00");
    expect(copy.isTerminal()).toBe(true);
    const rehydrated = Wallet.rehydrate(w.snapshot);
    expect(rehydrated.version).toBe(3);
  });
  test("ledger rejects inconsistent arithmetic", () => {
    const w = wallet();
    expect(() =>
      WalletLedgerEntry.create({
        id: "l",
        walletId: w.id,
        transactionId: "t",
        direction: "DEBIT",
        money: money("10.00"),
        balanceBefore: money("100.00"),
        balanceAfter: money("95.00"),
        createdAt: new Date(),
      }),
    ).toThrow("INVALID_LEDGER");
  });
});
test("canonical hash ignores key order and changes on any business change", () => {
  const w = wallet();
  const tx = transaction(w, "BET", "1.00");
  const p = tx.input as WagerInput;
  const reordered = Object.fromEntries(Object.entries(p).reverse()) as unknown as WagerInput;
  expect(payloadHash(p)).toBe(payloadHash(reordered));
  expect(tx.matchesPayload(payloadHash({ ...p, gameId: "other" }))).toBe(false);
});
test("inbox conflicts and outbox lifecycle", () => {
  const inbox = InboxMessage.receive({ messageId: "m", consumerName: "c", payloadHash: "h" });
  expect(() => inbox.assertPayload("different")).toThrow("INBOX_CONFLICT");
  inbox.markProcessed("t");
  expect(InboxMessage.rehydrate(inbox.snapshot).isProcessed()).toBe(true);
  expect(() => inbox.markProcessed("t")).toThrow();
  const w = wallet();
  const tx = transaction(w, "LOSS", "0.00");
  tx.apply(w, undefined, false, 3, 1);
  const out = OutboxMessage.enqueue(WagerTransactionProcessed.from(tx));
  const id = out.snapshot.id;
  out.scheduleRetry(new Date());
  expect(out.snapshot.attempts).toBe(1);
  out.markPublished(new Date());
  expect(out.isPending()).toBe(false);
  expect(out.snapshot.id).toBe(id);
  expect(out.snapshot.payload.version).toBe(1);
});

test("use case rejects an idempotency key with divergent business payload before writing", async () => {
  const { ProcessWager } = await import("../../src/application/process-wager");
  const { Telemetry } = await import("../../src/infrastructure/observability/telemetry");
  const w = wallet();
  const existing = transaction(w, "BET", "10.00");
  existing.apply(w, undefined, false, 3, 1);
  const unexpected = async () => {
    throw new Error("Unexpected mutation/read after conflict");
  };
  const unit: import("../../src/application/ports").FinancialUnit = {
    claimDueReference: unexpected,
    lockWallet: async () => w,
    byKey: async () => existing,
    findTransaction: async () => existing,
    insertWallet: unexpected,
    saveWallet: unexpected,
    byId: unexpected,
    saveTransaction: unexpected,
    bindKey: unexpected,
    reversed: unexpected,
    append: unexpected,
    receiveInbox: unexpected,
    saveInbox: unexpected,
    enqueue: unexpected,
  };
  const processor = new ProcessWager({ atomic: (work) => work(unit) }, new Telemetry());
  await expect(
    processor.execute(
      { ...existing.input, money: { amount: "11.00", currency: "BRL" } },
      existing.snapshot.idempotencyKey,
      { correlationId: "conflict-unit" },
    ),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", httpStatus: 409 });
  expect(w.balance.toString()).toBe("90.00");
});

test("event envelope cannot be mutated through a serialized copy", () => {
  const w = wallet();
  const tx = transaction(w, "LOSS", "0.00");
  tx.apply(w, undefined, false, 3, 1);
  const event = WagerTransactionProcessed.from(tx);
  const json = event.toJSON();
  json.data.status = "FAILED";
  expect(event.toJSON().data.status).toBe("PROCESSED");
});

test("factories and rehydration do not expose mutable Date references", () => {
  const at = new Date("2026-11-16T00:00:00Z");
  const ledger = WalletLedgerEntry.create({
    id: "l",
    walletId: "w",
    transactionId: "t",
    direction: "CREDIT",
    money: money("1.00"),
    balanceBefore: money("0.00"),
    balanceAfter: money("1.00"),
    createdAt: at,
  });
  at.setFullYear(2000);
  expect(ledger.snapshot.createdAt.getUTCFullYear()).toBe(2026);
  const w = wallet();
  const state = w.snapshot;
  const copy = Wallet.rehydrate(state);
  state.createdAt.setFullYear(2000);
  expect(copy.snapshot.createdAt.getTime()).toBe(w.snapshot.createdAt.getTime());
  const tx = transaction(w, "LOSS", "0.00");
  const saved = tx.snapshot;
  const recovered = WagerTransaction.rehydrate(saved);
  saved.nextAttemptAt.setFullYear(2000);
  expect(recovered.snapshot.nextAttemptAt.getTime()).toBe(tx.snapshot.nextAttemptAt.getTime());
  const inbox = InboxMessage.receive({ consumerName: "c", messageId: "m", payloadHash: "h" });
  const inboxDate = inbox.snapshot.receivedAt.getTime();
  inbox.snapshot.receivedAt.setFullYear(2000);
  expect(inbox.snapshot.receivedAt.getTime()).toBe(inboxDate);
  tx.apply(w, undefined, false, 3, 1);
  const out = OutboxMessage.enqueue(WagerTransactionProcessed.from(tx));
  const next = out.snapshot.nextAttemptAt.getTime();
  out.snapshot.nextAttemptAt.setFullYear(2000);
  expect(out.snapshot.nextAttemptAt.getTime()).toBe(next);
  const published = new Date();
  out.markPublished(published);
  const year = published.getFullYear();
  published.setFullYear(2000);
  expect(out.snapshot.publishedAt!.getFullYear()).toBe(year);
});

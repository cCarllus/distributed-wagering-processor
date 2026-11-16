import { config } from "../config";
import {
  WagerTransactionFailed,
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from "../domain/events";
import { InboxMessage, OutboxMessage } from "../domain/messages";
import { DomainError, Money } from "../domain/money";
import { WagerTransaction } from "../domain/wager";
import { Wallet, WalletLedgerEntry } from "../domain/wallet";

import {
  ApplicationError,
  dbCode,
  hashValue,
  keySchema,
  parse,
  payloadHash,
  wagerSchema,
  walletSchema,
} from "./contracts";
import type { FinancialStore, FinancialUnit, ProcessingHooks, ProcessingTelemetry } from "./ports";
export interface ProcessContext {
  correlationId: string;
  messageId?: string;
  consumerName?: string;
}
export class ProcessWager {
  constructor(
    private readonly store: FinancialStore,
    private readonly telemetry: ProcessingTelemetry,
    private readonly hooks: ProcessingHooks = {},
  ) {}
  async open(raw: unknown) {
    const input = parse(walletSchema, raw);
    const wallet = Wallet.open({
      id: crypto.randomUUID(),
      playerId: input.playerId,
      initialBalance: Money.from(input.initialBalance),
    });
    try {
      await this.store.atomic(async (unit) => {
        await unit.insertWallet(wallet);
        if (wallet.balance.isPositive()) {
          const tx = WagerTransaction.opening(wallet);
          const entry = WalletLedgerEntry.create({
            id: crypto.randomUUID(),
            walletId: wallet.id,
            transactionId: tx.id,
            direction: "CREDIT",
            money: wallet.balance,
            balanceBefore: Money.zero(wallet.currency),
            balanceAfter: wallet.balance,
            createdAt: new Date(),
          });
          await unit.saveTransaction(tx);
          await unit.bindKey(tx.snapshot.idempotencyKey, tx);
          await unit.append(entry);
          await this.events(unit, tx, wallet, entry);
        }
        await this.hooks.beforeCommit?.();
      });
    } catch (error) {
      if (dbCode(error) === "23505") throw new ApplicationError("WALLET_EXISTS", 409);
      throw error;
    }
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }
  async execute(raw: unknown, rawKey: unknown, ctx: ProcessContext, permanentFailure?: string) {
    const input = parse(wagerSchema, raw);
    const key = parse(keySchema, rawKey);
    const hash = payloadHash(input);
    let candidate: WagerTransaction;
    try {
      candidate = WagerTransaction.create(input, key, hash, ctx.correlationId, ctx.messageId);
    } catch (error) {
      if (error instanceof DomainError) throw new ApplicationError(error.code, 400);
      throw error;
    }
    const end = this.telemetry.latency.startTimer();
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await this.store.atomic(async (unit) => {
            let inbox: InboxMessage | undefined;
            if (ctx.messageId) {
              inbox = await unit.receiveInbox(
                InboxMessage.receive({
                  messageId: ctx.messageId,
                  consumerName: ctx.consumerName ?? "wager-consumer-v1",
                  payloadHash: hashValue({ hash, key }),
                }),
              );
              const original = inbox.isProcessed()
                ? await unit.byId(inbox.snapshot.transactionId!)
                : undefined;
              try {
                inbox.assertPayload(hashValue({ hash, key }));
              } catch {
                // Preserve existing inbox entries written before UUID normalization.
                // Both the historical key/hash and the normalized business identity
                // must agree; no persisted hash or terminal result is rewritten.
                if (!original || !this.matches(original, hash))
                  throw new ApplicationError("INBOX_CONFLICT", 409);
                try {
                  inbox.assertPayload(hashValue({ hash: original.snapshot.payloadHash, key }));
                } catch {
                  throw new ApplicationError("INBOX_CONFLICT", 409);
                }
              }
              if (original) return original.response(true);
            }
            const wallet = await unit.lockWallet(input.walletId);
            const byKey = await unit.byKey(key);
            const byExternal = await unit.findTransaction(
              input.providerId,
              input.externalTransactionId,
            );
            if (byKey && (!this.matches(byKey, hash) || (byExternal && byKey.id !== byExternal.id)))
              throw new ApplicationError("IDEMPOTENCY_CONFLICT", 409);
            if (byExternal && !this.matches(byExternal, hash))
              throw new ApplicationError("EXTERNAL_ID_CONFLICT", 409);
            const existing = byKey ?? byExternal;
            if (existing) {
              await unit.bindKey(key, existing);
              if (inbox) {
                inbox.markProcessed(existing.id);
                await unit.saveInbox(inbox);
              }
              return existing.response(true);
            }
            // A fresh domain instance is required after a rolled-back attempt.
            candidate = WagerTransaction.create(input, key, hash, ctx.correlationId, ctx.messageId);
            if (permanentFailure) {
              candidate.fail(permanentFailure, wallet);
              await unit.saveTransaction(candidate);
              await this.events(unit, candidate, wallet);
            } else await this.apply(unit, candidate, wallet);
            await unit.bindKey(key, candidate);
            if (inbox) {
              inbox.markProcessed(candidate.id);
              await unit.saveInbox(inbox);
            }
            await this.hooks.beforeCommit?.();
            return candidate.response();
          });
          if (result.idempotentReplay) this.telemetry.duplicates.inc();
          else this.telemetry.transactions.inc({ status: result.status });
          this.telemetry.log("wager_committed", {
            ...ctx,
            transactionId: result.transactionId,
            walletId: input.walletId,
            providerId: input.providerId,
            status: result.status,
          });
          return result;
        } catch (error) {
          const code = dbCode(error);
          if (attempt >= 4 || !["23505", "40001", "40P01", "55P03"].includes(code)) throw error;
          this.telemetry.retries.inc({ component: "database" });
          if (code !== "23505") this.telemetry.locks.inc();
          await Bun.sleep(10 * 2 ** attempt + Math.floor(Math.random() * 10));
        }
      }
    } finally {
      end();
    }
  }
  private matches(tx: WagerTransaction, hash: string): boolean {
    if (tx.matchesPayload(hash)) return true;
    const normalized = wagerSchema.safeParse(tx.input);
    return normalized.success && payloadHash(normalized.data) === hash;
  }
  private async apply(unit: FinancialUnit, tx: WagerTransaction, wallet?: Wallet): Promise<void> {
    const p = tx.input;
    const cfg = config();
    const reference = p.referenceExternalTransactionId
      ? await unit.findTransaction(p.providerId, p.referenceExternalTransactionId)
      : undefined;
    const reversed = reference ? await unit.reversed(reference.id, p.kind) : false;
    const oldStatus = tx.status;
    const entry = tx.apply(
      wallet,
      reference,
      reversed,
      cfg.referenceMaxAttempts,
      cfg.referenceBackoffMs,
    );
    await unit.saveTransaction(tx);
    if (entry && wallet) {
      await unit.append(entry);
      await unit.saveWallet(wallet);
    }
    // Repeated polling without a state change does not create an unbounded event stream.
    if (tx.status !== oldStatus) await this.events(unit, tx, wallet, entry);
  }
  async retryReference(id?: string): Promise<boolean> {
    const decision = await this.store.atomic(async (unit) => {
      let tx: WagerTransaction | undefined;
      let wallet: Wallet | undefined;
      if (id) {
        const found = await unit.byId(id);
        if (!found) return false;
        wallet = await unit.lockWallet(found.input.walletId);
        tx = await unit.byId(id);
      } else {
        const claimed = await unit.claimDueReference();
        if (!claimed) return false;
        wallet = claimed.wallet;
        tx = claimed.transaction;
      }
      if (
        !tx ||
        tx.status !== "PENDING_REFERENCE" ||
        tx.snapshot.nextAttemptAt.getTime() > Date.now()
      )
        return false;
      await this.apply(unit, tx, wallet);
      await this.hooks.beforeCommit?.();
      return {
        status: tx.status,
        previous: "PENDING_REFERENCE",
        walletId: tx.input.walletId,
        transactionId: tx.id,
        providerId: tx.input.providerId,
        correlationId: tx.snapshot.correlationId,
      };
    });
    if (!decision) return false;
    if (decision.status !== decision.previous)
      this.telemetry.transactions.inc({ status: decision.status });
    this.telemetry.log("reference_committed", decision);
    return true;
  }
  private async events(
    unit: FinancialUnit,
    tx: WagerTransaction,
    wallet?: Wallet,
    entry?: WalletLedgerEntry,
  ): Promise<void> {
    const event =
      tx.status === "PROCESSED"
        ? WagerTransactionProcessed.from(tx)
        : tx.status === "REJECTED"
          ? WagerTransactionRejected.from(tx)
          : tx.status === "FAILED"
            ? WagerTransactionFailed.from(tx)
            : WagerTransactionPendingReference.from(tx);
    await unit.enqueue(OutboxMessage.enqueue(event));
    if (wallet && entry)
      await unit.enqueue(OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, entry, tx)));
  }
}

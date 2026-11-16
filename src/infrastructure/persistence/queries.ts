import type { MikroORM } from "@mikro-orm/postgresql";
import { z } from "zod";
import { ApplicationError, parse, uuidSchema } from "../../application/contracts";
import { Money } from "../../domain/money";
import type { Telemetry } from "../observability/telemetry";
import { WalletRecord } from "./entities";
import { PgStore, PgUnit, walletFrom } from "./store";

const cursorSchema = z.strictObject({
  walletId: uuidSchema,
  after: z.string().regex(/^\d+$/).max(20),
  through: z.string().regex(/^\d+$/).max(20),
});
export class Queries {
  constructor(
    private readonly orm: MikroORM,
    private readonly telemetry: Telemetry,
  ) {}
  async wallet(id: string) {
    id = parse(uuidSchema, id);
    const row = await this.orm.em.fork().findOne(WalletRecord, { id });
    if (!row) throw new ApplicationError("WALLET_NOT_FOUND", 404);
    const w = walletFrom(row);
    return { id: w.id, playerId: w.playerId, balance: w.balance.toJSON(), version: w.version };
  }
  async transaction(id: string) {
    id = parse(uuidSchema, id);
    const tx = await new PgUnit(this.orm.em.fork()).byId(id);
    if (!tx) throw new ApplicationError("TRANSACTION_NOT_FOUND", 404);
    return {
      ...tx.input,
      ...tx.response(),
      createdAt: tx.snapshot.createdAt,
      referenceTransactionId: tx.snapshot.referenceTransactionId,
    };
  }
  async external(provider: string, external: string) {
    const tx = await new PgUnit(this.orm.em.fork()).findTransaction(provider, external);
    if (!tx) throw new ApplicationError("TRANSACTION_NOT_FOUND", 404);
    return this.transaction(tx.id);
  }
  async ledger(walletId: string, cursor?: string, rawLimit?: string) {
    walletId = parse(uuidSchema, walletId);
    await this.wallet(walletId);
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ApplicationError("INVALID_LIMIT", 400);
    let after = "0";
    let through: string;
    const unit = new PgUnit(this.orm.em.fork());
    if (cursor) {
      try {
        if (cursor.length > 512) throw new Error();
        const c = parse(cursorSchema, JSON.parse(Buffer.from(cursor, "base64url").toString()));
        if (
          c.walletId !== walletId ||
          BigInt(c.after) > BigInt(c.through) ||
          BigInt(c.through) > 9223372036854775807n
        )
          throw new Error();
        after = c.after;
        through = c.through;
      } catch {
        throw new ApplicationError("INVALID_CURSOR", 400);
      }
    } else {
      const [max] = await unit.sql<{ max: string }>(
        "SELECT COALESCE(max(sequence),0)::text AS max FROM wallet_ledger WHERE wallet_id=?",
        [walletId],
      );
      through = max!.max;
    }
    const rows = await unit.sql<{
      id: string;
      sequence: string;
      transaction_id: string;
      direction: string;
      amount: string;
      currency: string;
      balance_before: string;
      balance_after: string;
      created_at: Date;
    }>(
      "SELECT * FROM wallet_ledger WHERE wallet_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?",
      [walletId, after, through, limit + 1],
    );
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        transactionId: r.transaction_id,
        direction: r.direction,
        money: Money.rehydrate(r.amount, r.currency).toJSON(),
        balanceBefore: Money.rehydrate(r.balance_before, r.currency).toJSON(),
        balanceAfter: Money.rehydrate(r.balance_after, r.currency).toJSON(),
        createdAt: r.created_at,
      })),
      nextCursor: more
        ? Buffer.from(JSON.stringify({ walletId, after: page.at(-1)!.sequence, through })).toString(
            "base64url",
          )
        : null,
    };
  }
  async reconcile(walletId: string) {
    walletId = parse(uuidSchema, walletId);
    return new PgStore(this.orm).atomic(async (port) => {
      const w = await port.lockWallet(walletId);
      if (!w) throw new ApplicationError("WALLET_NOT_FOUND", 404);
      const unit = port as PgUnit;
      const [sum] = await unit.sql<{ total: string; count: string }>(
        "SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END),0)::text AS total,count(*)::text AS count FROM wallet_ledger WHERE wallet_id=?",
        [walletId],
      );
      const calculated = Money.rehydrate(sum!.total, w.currency);
      const consistent = w.balance.equals(calculated);
      if (!consistent) {
        this.telemetry.divergence.inc();
        this.telemetry.log("reconciliation_divergence", { walletId, code: "LEDGER_DIVERGENCE" });
      }
      return {
        walletId,
        storedBalance: w.balance.toJSON(),
        calculatedBalance: calculated.toJSON(),
        difference: Money.rehydrate(
          BigInt(w.balance.toCents()) - BigInt(calculated.toCents()),
          w.currency,
        ).toJSON(),
        consistent,
        checkedEntries: Number(sum!.count),
      };
    });
  }
}

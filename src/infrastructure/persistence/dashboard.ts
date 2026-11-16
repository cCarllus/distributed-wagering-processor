import type { MikroORM } from "@mikro-orm/postgresql";
import { z } from "zod";
import { ApplicationError, hashValue, parse, uuidSchema } from "../../application/contracts";
import { Money } from "../../domain/money";

const currency = z.enum(["BRL", "USD", "EUR"]).default("BRL");
const listSchema = z.strictObject({
  currency,
  query: z.string().max(128).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(12),
  cursor: z.string().max(1024).optional(),
  walletId: uuidSchema.optional(),
  status: z.enum(["PROCESSED", "REJECTED", "FAILED", "PENDING", "PENDING_REFERENCE"]).optional(),
  kind: z.enum(["OPENING", "BET", "WIN", "LOSS", "REFUND", "ROLLBACK"]).optional(),
});
const cursorSchema = z.strictObject({
  scope: z.string().length(64),
  at: z.string().regex(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,6})?\+00$/),
  id: uuidSchema,
});
type Row = {
  id: string;
  player_id: string;
  currency: string;
  balance: string;
  version: number;
  wallet_id: string;
  provider_id: string;
  external_id: string;
  amount: string;
  kind: string;
  status: string;
  failure_code: string | null;
  created_at: Date;
  cursor_at: string;
};

/** Read models only. Financial writes continue through ProcessWager. */
export class DashboardQueries {
  constructor(private readonly orm: MikroORM) {}
  async overview(raw: unknown) {
    const filters = parse(
      z.strictObject({ currency, days: z.enum(["7", "30"]).default("7") }),
      raw,
    );
    // One statement provides a consistent snapshot; never sum currencies together.
    const [row] = await this.orm.em.getConnection().execute<
      {
        balance: string;
        wallets: number;
        transactions: number;
        processed: number;
        rejected: number;
        pending: number;
        failed: number;
        activity: { day: string; total: number }[];
      }[]
    >(
      `
      WITH w AS (SELECT COALESCE(sum(balance),0)::text balance, count(*)::int wallets FROM wallets WHERE currency=?),
      t AS (SELECT * FROM wager_transactions WHERE currency=? AND kind<>'OPENING'),
      days AS (SELECT generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date - (?::int-1),
        (now() AT TIME ZONE 'America/Sao_Paulo')::date, interval '1 day')::date AS bucket_day),
      activity AS (SELECT days.bucket_day, count(t.id)::int total FROM days LEFT JOIN t
        ON (t.created_at AT TIME ZONE 'America/Sao_Paulo')::date=days.bucket_day GROUP BY days.bucket_day)
      SELECT w.*, (SELECT count(*)::int FROM t) transactions,
        (SELECT count(*)::int FROM t WHERE status='PROCESSED') processed,
        (SELECT count(*)::int FROM t WHERE status='REJECTED') rejected,
        (SELECT count(*)::int FROM t WHERE status IN ('PENDING','PENDING_REFERENCE')) pending,
        (SELECT count(*)::int FROM t WHERE status='FAILED') failed,
        (SELECT json_agg(json_build_object('day',bucket_day::text,'total',total) ORDER BY bucket_day) FROM activity) activity
      FROM w`,
      [filters.currency, filters.currency, filters.days],
    );
    return {
      ...row!,
      balance: Money.rehydrate(row!.balance, filters.currency).toJSON(),
      checkedAt: new Date().toISOString(),
    };
  }
  async list(kind: "wallets" | "transactions", raw: unknown) {
    const { cursor, limit, ...filters } = parse(listSchema, raw);
    if (kind === "wallets" && (filters.walletId || filters.status || filters.kind))
      throw new ApplicationError("INVALID_PAYLOAD", 400);
    const scope = hashValue({ kind, ...filters });
    const params: unknown[] = [filters.currency];
    const conditions = ["currency=?"];
    if (filters.query) {
      // Literal substring search: LIKE metacharacters never alter search semantics.
      conditions.push(
        kind === "wallets"
          ? "(strpos(id::text,?)>0 OR strpos(player_id::text,?)>0)"
          : "(strpos(id::text,?)>0 OR strpos(external_id,?)>0 OR strpos(provider_id,?)>0)",
      );
      params.push(...Array(kind === "wallets" ? 2 : 3).fill(filters.query));
    }
    for (const [column, value] of [
      ["wallet_id", filters.walletId],
      ["status", filters.status],
      ["kind", filters.kind],
    ]) {
      if (value) {
        conditions.push(`${column}=?`);
        params.push(value);
      }
    }
    if (cursor) {
      try {
        const decoded = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString()));
        if (decoded.scope !== scope) throw new Error();
        const instant = new Date(decoded.at.replace(" ", "T").replace("+00", "Z"));
        if (
          !Number.isFinite(instant.getTime()) ||
          instant.toISOString().slice(0, 19) !== decoded.at.slice(0, 19).replace(" ", "T")
        )
          throw new Error();
        conditions.push("(created_at,id)<(?::timestamptz,?::uuid)");
        params.push(decoded.at, decoded.id);
      } catch {
        throw new ApplicationError("INVALID_CURSOR", 400);
      }
    }
    params.push(limit + 1);
    const table = kind === "wallets" ? "wallets" : "wager_transactions";
    // UTC text retains PostgreSQL microseconds; JS Date would lose cursor precision.
    const rows = await this.orm.em.getConnection().execute<Row[]>(
      `SELECT *,
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') || '+00' cursor_at
      FROM ${table} WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC,id DESC LIMIT ?`,
      params,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((r) =>
        kind === "wallets"
          ? {
              id: r.id,
              playerId: r.player_id,
              balance: Money.rehydrate(r.balance, r.currency).toJSON(),
              version: r.version,
              createdAt: r.created_at,
            }
          : {
              transactionId: r.id,
              walletId: r.wallet_id,
              providerId: r.provider_id,
              externalTransactionId: r.external_id,
              kind: r.kind,
              status: r.status,
              money: Money.rehydrate(r.amount, r.currency).toJSON(),
              failureCode: r.failure_code,
              createdAt: r.created_at,
            },
      ),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(JSON.stringify({ scope, at: last.cursor_at, id: last.id })).toString(
              "base64url",
            )
          : null,
    };
  }
  async operations() {
    const [row] = await this.orm.em.getConnection().execute<
      {
        outboxPending: number;
        outboxPublished: number;
        outboxRetries: number;
        oldestPendingAt: Date | null;
        inbox: number;
      }[]
    >(`SELECT count(*) FILTER(WHERE published_at IS NULL)::int "outboxPending",
      count(*) FILTER(WHERE published_at IS NOT NULL)::int "outboxPublished",
      count(*) FILTER(WHERE published_at IS NULL AND attempts>0)::int "outboxRetries",
      min(occurred_at) FILTER(WHERE published_at IS NULL) "oldestPendingAt",
      (SELECT count(*)::int FROM inbox) inbox FROM outbox`);
    return { ...row!, checkedAt: new Date().toISOString() };
  }
}

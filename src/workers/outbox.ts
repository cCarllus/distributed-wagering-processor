import type { MikroORM } from "@mikro-orm/postgresql";
import { config } from "../config";
import { OutboxMessage } from "../domain/messages";
import { EVENTS_QUEUE, type LocalSqs } from "../infrastructure/messaging/sqs";
import type { Telemetry } from "../infrastructure/observability/telemetry";
import { Heartbeat } from "./heartbeat";
export interface OutboxRow {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  attempts: number;
  next_attempt_at: Date;
  published_at: Date | null;
}
export interface PublisherHooks {
  afterSendBeforeMark?: (id: string) => Promise<void>;
}
export class OutboxPublisher {
  constructor(
    private readonly orm: MikroORM,
    private readonly sqs: LocalSqs,
    private readonly telemetry: Telemetry,
    private readonly hooks: PublisherHooks = {},
  ) {}
  async tick(): Promise<number> {
    const token = crypto.randomUUID();
    const connection = this.orm.em.getConnection();
    const rows = await connection.execute<OutboxRow[]>(
      `WITH due AS (
 SELECT id FROM outbox WHERE published_at IS NULL AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY occurred_at,id FOR UPDATE SKIP LOCKED LIMIT 10)
 UPDATE outbox o SET lease_token=?, lease_until=clock_timestamp()+(? * interval '1 millisecond') FROM due WHERE o.id=due.id RETURNING o.*`,
      [token, config().outboxLeaseMs],
    );
    // Renew the whole reservation while a slow send is in flight. A dead process stops
    // renewing; every mark remains fenced by the persisted token.
    const heartbeat = new Heartbeat(
      Math.max(50, Math.floor(config().outboxLeaseMs / 3)),
      () =>
        connection.execute(
          "UPDATE outbox SET lease_until=clock_timestamp()+(? * interval '1 millisecond') WHERE lease_token=? AND published_at IS NULL AND lease_until>clock_timestamp()",
          [config().outboxLeaseMs, token],
        ),
      () => this.telemetry.log("outbox_lease_unavailable", { code: "DATABASE_UNAVAILABLE" }),
    );
    try {
      for (const row of rows) {
        const message = OutboxMessage.rehydrate({
          id: row.id,
          aggregateId: row.aggregate_id,
          eventType: row.event_type,
          payload: row.payload,
          occurredAt: new Date(row.occurred_at),
          attempts: row.attempts,
          nextAttemptAt: new Date(row.next_attempt_at),
        });
        try {
          // Revalidate ownership before EACH send. An expired/stolen reservation
          // must not send its remaining batch, even if an earlier send succeeded.
          const owned = await connection.execute<{ id: string }[]>(
            "UPDATE outbox SET lease_until=clock_timestamp()+(? * interval '1 millisecond') WHERE id=? AND lease_token=? AND published_at IS NULL AND lease_until>clock_timestamp() RETURNING id",
            [config().outboxLeaseMs, row.id, token],
          );
          if (owned.length === 0) {
            this.telemetry.log("outbox_lease_lost", { walletId: row.aggregate_id });
            continue;
          }
          await this.sqs.send(EVENTS_QUEUE, JSON.stringify(row.payload), row.aggregate_id, row.id);
          await this.hooks.afterSendBeforeMark?.(row.id);
          const publishedAt = new Date();
          const marked = await connection.execute<{ id: string }[]>(
            "UPDATE outbox SET published_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND lease_until>clock_timestamp() AND published_at IS NULL RETURNING id",
            [publishedAt, row.id, token],
          );
          if (marked.length) message.markPublished(publishedAt);
        } catch {
          message.scheduleRetry(new Date());
          const s = message.snapshot;
          await connection.execute(
            "UPDATE outbox SET attempts=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND lease_until>clock_timestamp() AND published_at IS NULL",
            [s.attempts, s.nextAttemptAt, row.id, token],
          );
          this.telemetry.retries.inc({ component: "outbox" });
          this.telemetry.log("outbox_retry", {
            walletId: row.aggregate_id,
            code: "PUBLISH_UNAVAILABLE",
          });
        }
      }
    } finally {
      await heartbeat.stop();
    }
    const [lag] = await connection.execute<{ seconds: string }[]>(
      "SELECT COALESCE(EXTRACT(EPOCH FROM now()-MIN(occurred_at)),0)::text AS seconds FROM outbox WHERE published_at IS NULL",
    );
    this.telemetry.lag.set(Number(lag?.seconds ?? "0"));
    return rows.length;
  }
}

import { Counter, Gauge, Histogram, Registry } from "prom-client";
export class Telemetry {
  readonly registry = new Registry();
  readonly transactions = new Counter({
    name: "wager_transactions_total",
    help: "Committed decisions",
    labelNames: ["status"],
    registers: [this.registry],
  });
  readonly duplicates = new Counter({
    name: "wager_duplicates_total",
    help: "Persistent replays",
    registers: [this.registry],
  });
  readonly retries = new Counter({
    name: "wager_retries_total",
    help: "Retries by component",
    labelNames: ["component"],
    registers: [this.registry],
  });
  readonly dlq = new Counter({
    name: "wager_dlq_total",
    help: "Messages sent to DLQ",
    registers: [this.registry],
  });
  readonly locks = new Counter({
    name: "wager_lock_conflicts_total",
    help: "Lock timeout, serialization or deadlock retries",
    registers: [this.registry],
  });
  readonly lag = new Gauge({
    name: "wager_outbox_lag_seconds",
    help: "Age of oldest unpublished event",
    registers: [this.registry],
  });
  readonly latency = new Histogram({
    name: "wager_processing_seconds",
    help: "Use case latency",
    buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [this.registry],
  });
  readonly divergence = new Counter({
    name: "wager_reconciliation_divergences_total",
    help: "Ledger discrepancies observed",
    registers: [this.registry],
  });
  log(
    event: string,
    ids: {
      correlationId?: string;
      messageId?: string;
      transactionId?: string;
      walletId?: string;
      providerId?: string;
      code?: string;
      status?: string;
    } = {},
  ): void {
    console.log(
      JSON.stringify({
        time: new Date().toISOString(),
        event,
        correlationId: ids.correlationId ?? null,
        messageId: ids.messageId ?? null,
        transactionId: ids.transactionId ?? null,
        walletId: ids.walletId ?? null,
        providerId: ids.providerId ?? null,
        code: ids.code,
        status: ids.status,
      }),
    );
  }
}

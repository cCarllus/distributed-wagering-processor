function integer(name: string, fallback: number, min = 1, max = 1000000): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`Invalid local configuration: ${name}`);
  return value;
}
export function config() {
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://wager_local:wager_local_only@127.0.0.1:55432/wager";
  const endpoint = process.env.SQS_ENDPOINT ?? "http://127.0.0.1:4568";
  const db = new URL(databaseUrl);
  const sqs = new URL(endpoint);
  if (
    !["127.0.0.1", "localhost", "postgres"].includes(db.hostname) ||
    !/^\/wager(?:_test|_migration)?$/.test(db.pathname) ||
    db.username !== "wager_local" ||
    db.password !== "wager_local_only"
  )
    throw new Error("Only the fictitious local PostgreSQL configuration is allowed");
  if (
    !["127.0.0.1", "localhost", "localstack"].includes(sqs.hostname) ||
    sqs.protocol !== "http:" ||
    sqs.username ||
    sqs.password
  )
    throw new Error("Only local SQS endpoints are allowed");
  return {
    databaseUrl,
    endpoint,
    host: process.env.HOST ?? "127.0.0.1",
    port: integer("PORT", 3100, 1, 65535),
    workers: process.env.WORKERS !== "false",
    referenceMaxAttempts: integer("REFERENCE_MAX_ATTEMPTS", 12, 1, 100),
    referenceBackoffMs: integer("REFERENCE_BACKOFF_MS", 1000),
    outboxLeaseMs: integer("OUTBOX_LEASE_MS", 10000, 100),
    maxReceives: integer("MAX_RECEIVES", 5, 1, 100),
    visibilitySeconds: integer("VISIBILITY_SECONDS", 10, 1, 43200),
  };
}

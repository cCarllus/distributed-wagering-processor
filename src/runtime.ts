import { ProcessWager } from "./application/process-wager";
import { LocalSqs } from "./infrastructure/messaging/sqs";
import { Telemetry } from "./infrastructure/observability/telemetry";
import { DashboardQueries } from "./infrastructure/persistence/dashboard";
import { connect } from "./infrastructure/persistence/orm";
import { Queries } from "./infrastructure/persistence/queries";
import { PgStore } from "./infrastructure/persistence/store";
import { WagerConsumer } from "./workers/consumer";
import { OutboxPublisher } from "./workers/outbox";
import { ReferenceWorker } from "./workers/references";
import { WorkerRunner } from "./workers/runner";
export async function createRuntime() {
  const orm = await connect();
  const sqs = new LocalSqs();
  const telemetry = new Telemetry();
  const processor = new ProcessWager(new PgStore(orm), telemetry);
  const queries = new Queries(orm, telemetry);
  const consumer = new WagerConsumer(sqs, processor, telemetry);
  const publisher = new OutboxPublisher(orm, sqs, telemetry);
  const references = new ReferenceWorker(processor, telemetry);
  const runner = new WorkerRunner(telemetry);
  return {
    orm,
    sqs,
    telemetry,
    processor,
    queries,
    dashboard: new DashboardQueries(orm),
    consumer,
    publisher,
    references,
    runner,
    startWorkers() {
      runner.start([
        { name: "consumer", tick: () => consumer.tick() },
        { name: "publisher", tick: () => publisher.tick() },
        { name: "references", tick: () => references.tick() },
      ]);
    },
    async close() {
      await runner.stop();
      sqs.close();
      await orm.close(true);
    },
  };
}
export type Runtime = Awaited<ReturnType<typeof createRuntime>>;

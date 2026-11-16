import { createRuntime } from "../../src/runtime";
import { WagerConsumer } from "../../src/workers/consumer";
import { WorkerRunner } from "../../src/workers/runner";

const r = await createRuntime();
const consumer = new WagerConsumer(r.sqs, r.processor, r.telemetry, {
  async afterCommitBeforeAck() {
    console.log("DRAINING_COMMITTED_MESSAGE");
    await Bun.sleep(500);
  },
});
const runner = new WorkerRunner(r.telemetry);
runner.start([{ name: "consumer", tick: () => consumer.tick() }]);
process.once("SIGTERM", () => {
  void (async () => {
    await runner.stop();
    await r.close();
    console.log("DRAINED_AND_ACKED");
  })();
});

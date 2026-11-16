import { createRuntime } from "../../src/runtime";
import { WagerConsumer } from "../../src/workers/consumer";

const r = await createRuntime();
const consumer = new WagerConsumer(r.sqs, r.processor, r.telemetry, {
  async afterCommitBeforeAck() {
    console.log("COMMITTED_BEFORE_ACK");
    await new Promise(() => {});
  },
});
await consumer.tick();
await r.close();

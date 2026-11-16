import { createRuntime } from "../../src/runtime";
import { OutboxPublisher } from "../../src/workers/outbox";

const r = await createRuntime();
const publisher = new OutboxPublisher(r.orm, r.sqs, r.telemetry, {
  async afterSendBeforeMark(id) {
    console.log(`SENT_BEFORE_MARK:${id}`);
    await new Promise(() => {});
  },
});
while ((await publisher.tick()) === 0) await Bun.sleep(50);
await r.close();

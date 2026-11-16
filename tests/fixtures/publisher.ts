import { createRuntime } from "../../src/runtime";
import { OutboxPublisher } from "../../src/workers/outbox";

const r = await createRuntime();
let published = 0;
const publisher = new OutboxPublisher(r.orm, r.sqs, r.telemetry, {
  async afterSendBeforeMark() {
    published++;
    // Hold the real lease briefly to exercise overlapping reservations deterministically.
    await Bun.sleep(5);
  },
});
try {
  const start = Number(process.env.PUBLISH_START_AT ?? "0");
  if (start > Date.now()) await Bun.sleep(start - Date.now());
  while ((await publisher.tick()) > 0) {}
  console.log(JSON.stringify({ publisherPid: process.pid, published }));
} finally {
  await r.close();
}

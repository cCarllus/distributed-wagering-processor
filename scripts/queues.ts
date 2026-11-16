import { LocalSqs } from "../src/infrastructure/messaging/sqs";

const sqs = new LocalSqs();
try {
  await sqs.setup();
  console.log("Local FIFO queues ready");
} finally {
  sqs.close();
}

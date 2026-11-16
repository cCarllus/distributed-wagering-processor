import {
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { config } from "../../config";
export const INPUT_QUEUE = "wager-transactions.fifo";
export const DLQ_QUEUE = "wager-transactions-dlq.fifo";
export const EVENTS_QUEUE = "wager-events.fifo";
export class LocalSqs {
  readonly client: SQSClient;
  private urls = new Map<string, string>();
  constructor() {
    this.client = new SQSClient({
      endpoint: config().endpoint,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      useQueueUrlAsEndpoint: false,
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 1000, requestTimeout: 4000 },
    });
  }
  async url(name: string): Promise<string> {
    const cached = this.urls.get(name);
    if (cached) return cached;
    const result = await this.client.send(new GetQueueUrlCommand({ QueueName: name }));
    if (!result.QueueUrl) throw new Error("LOCAL_QUEUE_NOT_FOUND");
    this.urls.set(name, result.QueueUrl);
    return result.QueueUrl;
  }
  async setup(): Promise<void> {
    const cfg = config();
    const dlq = await this.client.send(
      new CreateQueueCommand({
        QueueName: DLQ_QUEUE,
        Attributes: { FifoQueue: "true", MessageRetentionPeriod: "1209600" },
      }),
    );
    const attrs = await this.client.send(
      new GetQueueAttributesCommand({ QueueUrl: dlq.QueueUrl, AttributeNames: ["QueueArn"] }),
    );
    await this.client.send(
      new CreateQueueCommand({
        QueueName: INPUT_QUEUE,
        Attributes: {
          FifoQueue: "true",
          ContentBasedDeduplication: "false",
          VisibilityTimeout: String(cfg.visibilitySeconds),
          ReceiveMessageWaitTimeSeconds: "2",
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: attrs.Attributes?.QueueArn,
            maxReceiveCount: cfg.maxReceives,
          }),
        },
      }),
    );
    await this.client.send(
      new CreateQueueCommand({
        QueueName: EVENTS_QUEUE,
        Attributes: {
          FifoQueue: "true",
          ContentBasedDeduplication: "false",
          VisibilityTimeout: "10",
        },
      }),
    );
  }
  async ready(): Promise<void> {
    for (const name of [INPUT_QUEUE, DLQ_QUEUE, EVENTS_QUEUE])
      await this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl: await this.url(name),
          AttributeNames: ["QueueArn"],
        }),
      );
  }
  async send(name: string, body: string, groupId: string, dedupId: string): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: await this.url(name),
        MessageBody: body,
        MessageGroupId: groupId,
        MessageDeduplicationId: dedupId,
      }),
    );
  }
  async receive(name = INPUT_QUEUE, wait = 2) {
    return (
      (
        await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: await this.url(name),
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: wait,
            MessageSystemAttributeNames: ["ApproximateReceiveCount"],
            VisibilityTimeout: config().visibilitySeconds,
          }),
        )
      ).Messages ?? []
    );
  }
  async ack(receipt: string, name = INPUT_QUEUE): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: await this.url(name), ReceiptHandle: receipt }),
    );
  }
  async visibility(receipt: string, seconds: number): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: await this.url(INPUT_QUEUE),
        ReceiptHandle: receipt,
        VisibilityTimeout: seconds,
      }),
    );
  }
  close(): void {
    this.client.destroy();
  }
}

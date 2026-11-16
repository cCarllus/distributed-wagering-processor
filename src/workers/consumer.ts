import type { Message } from "@aws-sdk/client-sqs";
import {
  ApplicationError,
  classifyFailure,
  dbCode,
  messageSchema,
  parse,
} from "../application/contracts";
import type { ProcessWager } from "../application/process-wager";
import { config } from "../config";
import { DomainError } from "../domain/money";
import { DLQ_QUEUE, type LocalSqs } from "../infrastructure/messaging/sqs";
import type { Telemetry } from "../infrastructure/observability/telemetry";
import { Heartbeat } from "./heartbeat";
export interface ConsumerHooks {
  afterCommitBeforeAck?: () => Promise<void>;
}
type Envelope = ReturnType<typeof messageSchema.parse>;
export class WagerConsumer {
  constructor(
    private readonly sqs: LocalSqs,
    private readonly processWager: ProcessWager,
    private readonly telemetry: Telemetry,
    private readonly hooks: ConsumerHooks = {},
  ) {}
  async tick(): Promise<boolean> {
    const messages = await this.sqs.receive();
    for (const message of messages) await this.handle(message);
    return messages.length > 0;
  }
  private async ack(receipt: string): Promise<void> {
    // Transport failures after commit must never become a new financial decision.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.sqs.ack(receipt);
        return;
      } catch (error) {
        if (attempt === 2) throw error;
        this.telemetry.retries.inc({ component: "ack" });
        await Bun.sleep(50 * 2 ** attempt);
      }
    }
  }
  private async deadLetter(message: Message, parsed?: Envelope): Promise<void> {
    await this.sqs.send(
      DLQ_QUEUE,
      message.Body ?? "{}",
      parsed?.data.walletId ?? "invalid",
      message.MessageId!,
    );
    await this.ack(message.ReceiptHandle!);
    this.telemetry.dlq.inc();
    this.telemetry.log("message_dlq", {
      correlationId: parsed?.messageId,
      messageId: parsed?.messageId ?? message.MessageId,
      walletId: parsed?.data.walletId,
      providerId: parsed?.data.providerId,
    });
  }
  async handle(message: Message): Promise<void> {
    if (!message.ReceiptHandle || !message.MessageId) return;
    const receipt = message.ReceiptHandle;
    const cfg = config();
    const heartbeat = new Heartbeat(
      Math.max(250, cfg.visibilitySeconds * 500),
      () => this.sqs.visibility(receipt, cfg.visibilitySeconds),
      () =>
        this.telemetry.log("visibility_extension_failed", {
          messageId: message.MessageId,
          code: "SQS_UNAVAILABLE",
        }),
    );
    let parsed: Envelope | undefined;
    let committed = false;
    try {
      try {
        parsed = parse(messageSchema, JSON.parse(message.Body ?? ""));
      } catch {
        throw new ApplicationError("INVALID_MESSAGE", 400);
      }
      const { idempotencyKey, ...input } = parsed.data;
      const result = await this.processWager.execute(input, idempotencyKey, {
        correlationId: parsed.messageId,
        messageId: parsed.messageId,
      });
      committed = true;
      await this.hooks.afterCommitBeforeAck?.();
      // FAILED + inbox can have committed before a crash preceding SendMessage to DLQ.
      // Recovery must finish that delivery before ACK, including an idempotent replay.
      if (result.status === "FAILED") await this.deadLetter(message, parsed);
      else await this.ack(receipt);
    } catch (error) {
      // Prevent a late heartbeat overwriting the visibility chosen below.
      await heartbeat.stop();
      const attempts = Number(message.Attributes?.ApproximateReceiveCount ?? "1");
      if (committed) {
        this.telemetry.retries.inc({ component: "delivery" });
        this.telemetry.log("committed_delivery_retry", {
          messageId: parsed?.messageId,
          code: dbCode(error),
        });
        await this.sqs.visibility(receipt, Math.min(2 ** (attempts - 1), 60));
        return;
      }
      const permanent = classifyFailure(error) === "permanent" || error instanceof DomainError;
      if (permanent || attempts >= cfg.maxReceives) {
        if (parsed && !(error instanceof ApplicationError) && !(error instanceof DomainError)) {
          const { idempotencyKey, ...input } = parsed.data;
          const decision = await this.processWager.execute(
            input,
            idempotencyKey,
            { correlationId: parsed.messageId, messageId: parsed.messageId },
            permanent ? "INFRASTRUCTURE_PERMANENT_FAILURE" : "INFRASTRUCTURE_RETRIES_EXHAUSTED",
          );
          // COMMIT may have succeeded although its response was lost. Resolve that
          // uncertainty via the durable identities, never DLQ a successful replay.
          if (decision.status !== "FAILED") {
            await this.ack(receipt);
            return;
          }
        }
        await this.deadLetter(message, parsed);
      } else {
        await this.sqs.visibility(receipt, Math.min(2 ** (attempts - 1), 60));
        this.telemetry.retries.inc({ component: "sqs" });
        this.telemetry.log("message_retry", {
          correlationId: parsed?.messageId,
          messageId: parsed?.messageId ?? message.MessageId,
          code: dbCode(error),
        });
      }
    } finally {
      await heartbeat.stop();
    }
  }
}

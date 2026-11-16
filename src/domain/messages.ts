import type { IntegrationEvent } from "./events";
import { DomainError } from "./money";
export interface InboxState {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt?: Date;
  transactionId?: string;
}
export class InboxMessage {
  private constructor(private state: InboxState) {
    this.state = {
      ...state,
      receivedAt: new Date(state.receivedAt),
      processedAt: state.processedAt ? new Date(state.processedAt) : undefined,
    };
  }
  static receive(props: Omit<InboxState, "receivedAt" | "processedAt">): InboxMessage {
    return new InboxMessage({ ...props, receivedAt: new Date() });
  }
  static rehydrate(state: InboxState): InboxMessage {
    return new InboxMessage({ ...state });
  }
  isProcessed(): boolean {
    return !!this.state.processedAt;
  }
  assertPayload(hash: string): void {
    if (hash !== this.state.payloadHash) throw new DomainError("INBOX_CONFLICT");
  }
  markProcessed(transactionId: string): void {
    if (this.isProcessed()) throw new DomainError("INBOX_ALREADY_PROCESSED");
    this.state = { ...this.state, processedAt: new Date(), transactionId };
  }
  get snapshot(): InboxState {
    return {
      ...this.state,
      receivedAt: new Date(this.state.receivedAt),
      processedAt: this.state.processedAt ? new Date(this.state.processedAt) : undefined,
    };
  }
}
export interface OutboxState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date;
  publishedAt?: Date;
}
export class OutboxMessage {
  private constructor(private state: OutboxState) {
    this.state = {
      ...state,
      payload: structuredClone(state.payload),
      occurredAt: new Date(state.occurredAt),
      nextAttemptAt: new Date(state.nextAttemptAt),
      publishedAt: state.publishedAt ? new Date(state.publishedAt) : undefined,
    };
  }
  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    const e = event.toJSON();
    return new OutboxMessage({
      id: e.eventId,
      aggregateId: e.aggregateId,
      eventType: e.eventType,
      payload: structuredClone(e),
      occurredAt: new Date(e.occurredAt),
      attempts: 0,
      nextAttemptAt: new Date(e.occurredAt),
    });
  }
  static rehydrate(state: OutboxState): OutboxMessage {
    return new OutboxMessage({ ...state, payload: structuredClone(state.payload) });
  }
  isPending(): boolean {
    return !this.state.publishedAt;
  }
  isDue(now: Date): boolean {
    return this.isPending() && this.state.nextAttemptAt <= now;
  }
  markPublished(at: Date): void {
    if (!this.isPending()) throw new DomainError("OUTBOX_ALREADY_PUBLISHED");
    this.state = { ...this.state, publishedAt: new Date(at) };
  }
  scheduleRetry(now: Date): void {
    if (!this.isPending()) throw new DomainError("OUTBOX_ALREADY_PUBLISHED");
    const attempts = this.state.attempts + 1;
    this.state = {
      ...this.state,
      attempts,
      nextAttemptAt: new Date(
        now.getTime() + Math.min(1000 * 2 ** Math.min(attempts - 1, 9), 300000),
      ),
    };
  }
  get snapshot(): OutboxState {
    return {
      ...this.state,
      payload: structuredClone(this.state.payload),
      occurredAt: new Date(this.state.occurredAt),
      nextAttemptAt: new Date(this.state.nextAttemptAt),
      publishedAt: this.state.publishedAt ? new Date(this.state.publishedAt) : undefined,
    };
  }
}

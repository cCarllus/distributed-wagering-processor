import type { WagerTransaction } from "./wager";
import type { Wallet, WalletLedgerEntry } from "./wallet";
export interface EventProps<T> {
  eventId: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
  data: T;
}
export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;
  protected readonly props: EventProps<T>;
  protected constructor(props: EventProps<T>) {
    this.props = structuredClone(props);
  }
  toJSON() {
    return {
      ...structuredClone(this.props),
      occurredAt: this.props.occurredAt.toISOString(),
      eventType: this.eventType,
      version: this.version,
    };
  }
}
function props<T>(tx: WagerTransaction, data: T): EventProps<T> {
  const s = tx.snapshot;
  return {
    eventId: crypto.randomUUID(),
    aggregateId: s.input.walletId,
    correlationId: s.correlationId,
    causationId: s.causationId ?? s.id,
    occurredAt: new Date(),
    data,
  };
}
type TransactionData = ReturnType<WagerTransaction["response"]>;
export class WagerTransactionProcessed extends IntegrationEvent<TransactionData> {
  readonly eventType = "WagerTransactionProcessed";
  readonly version = 1;
  static from(tx: WagerTransaction): WagerTransactionProcessed {
    return new WagerTransactionProcessed(props(tx, tx.response()));
  }
}
export class WagerTransactionRejected extends IntegrationEvent<TransactionData> {
  readonly eventType = "WagerTransactionRejected";
  readonly version = 1;
  static from(tx: WagerTransaction): WagerTransactionRejected {
    return new WagerTransactionRejected(props(tx, tx.response()));
  }
}
export class WagerTransactionPendingReference extends IntegrationEvent<TransactionData> {
  readonly eventType = "WagerTransactionPendingReference";
  readonly version = 1;
  static from(tx: WagerTransaction): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference(props(tx, tx.response()));
  }
}
export class WagerTransactionFailed extends IntegrationEvent<TransactionData> {
  readonly eventType = "WagerTransactionFailed";
  readonly version = 1;
  static from(tx: WagerTransaction): WagerTransactionFailed {
    return new WagerTransactionFailed(props(tx, tx.response()));
  }
}
export class WalletBalanceChanged extends IntegrationEvent<Record<string, unknown>> {
  readonly eventType = "WalletBalanceChanged";
  readonly version = 1;
  static from(
    wallet: Wallet,
    entry: WalletLedgerEntry,
    tx: WagerTransaction,
  ): WalletBalanceChanged {
    const s = entry.snapshot;
    return new WalletBalanceChanged(
      props(tx, {
        walletId: wallet.id,
        transactionId: tx.id,
        direction: s.direction,
        money: s.money.toJSON(),
        balanceBefore: s.balanceBefore.toJSON(),
        balanceAfter: s.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      }),
    );
  }
}

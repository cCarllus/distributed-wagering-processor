import type { InboxMessage, OutboxMessage } from "../domain/messages";
import type { WagerTransaction } from "../domain/wager";
import type { Wallet, WalletLedgerEntry } from "../domain/wallet";
export interface FinancialUnit {
  claimDueReference(): Promise<{ transaction: WagerTransaction; wallet: Wallet } | undefined>;
  lockWallet(id: string): Promise<Wallet | undefined>;
  insertWallet(wallet: Wallet): Promise<void>;
  saveWallet(wallet: Wallet): Promise<void>;
  findTransaction(providerId: string, externalId: string): Promise<WagerTransaction | undefined>;
  byId(id: string): Promise<WagerTransaction | undefined>;
  byKey(key: string): Promise<WagerTransaction | undefined>;
  saveTransaction(tx: WagerTransaction): Promise<void>;
  bindKey(key: string, tx: WagerTransaction): Promise<void>;
  reversed(referenceId: string, kind: string): Promise<boolean>;
  append(entry: WalletLedgerEntry): Promise<void>;
  receiveInbox(message: InboxMessage): Promise<InboxMessage>;
  saveInbox(message: InboxMessage): Promise<void>;
  enqueue(message: OutboxMessage): Promise<void>;
}
export interface FinancialStore {
  atomic<T>(work: (unit: FinancialUnit) => Promise<T>): Promise<T>;
}
export interface ProcessingHooks {
  beforeCommit?: () => Promise<void>;
}

export interface ProcessingTelemetry {
  transactions: { inc(labels: { status: string }): void };
  duplicates: { inc(): void };
  retries: { inc(labels: { component: string }): void };
  locks: { inc(): void };
  latency: { startTimer(): () => unknown };
  log(
    event: string,
    ids?: {
      correlationId?: string;
      messageId?: string;
      transactionId?: string;
      walletId?: string;
      providerId?: string;
      code?: string;
      status?: string;
    },
  ): void;
}

import { DomainError, Money } from "./money";
export type LedgerDirection = "CREDIT" | "DEBIT";
export interface LedgerState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}
export class WalletLedgerEntry {
  private constructor(private readonly state: Readonly<LedgerState>) {
    this.state = Object.freeze({ ...state, createdAt: new Date(state.createdAt) });
    Object.freeze(this);
  }
  static create(state: LedgerState): WalletLedgerEntry {
    const entry = new WalletLedgerEntry(Object.freeze({ ...state }));
    if (!state.money.isPositive() || state.balanceAfter.isNegative() || !entry.isBalanced())
      throw new DomainError("INVALID_LEDGER");
    return entry;
  }
  static rehydrate(state: LedgerState): WalletLedgerEntry {
    return new WalletLedgerEntry(Object.freeze({ ...state }));
  }
  isBalanced(): boolean {
    const s = this.state;
    return (
      s.direction === "CREDIT" ? s.balanceBefore.add(s.money) : s.balanceBefore.subtract(s.money)
    ).equals(s.balanceAfter);
  }
  get snapshot(): Readonly<LedgerState> {
    return { ...this.state, createdAt: new Date(this.state.createdAt) };
  }
}
export interface WalletState {
  id: string;
  playerId: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
export class Wallet {
  private constructor(private state: WalletState) {
    this.state = {
      ...state,
      createdAt: new Date(state.createdAt),
      updatedAt: new Date(state.updatedAt),
    };
  }
  static open(props: { id: string; playerId: string; initialBalance: Money }): Wallet {
    if (props.initialBalance.isNegative()) throw new DomainError("NEGATIVE_BALANCE");
    const now = new Date();
    return new Wallet({
      id: props.id,
      playerId: props.playerId,
      balance: props.initialBalance,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
  static rehydrate(state: WalletState): Wallet {
    return new Wallet({ ...state });
  }
  get id(): string {
    return this.state.id;
  }
  get playerId(): string {
    return this.state.playerId;
  }
  get currency(): string {
    return this.balance.currency;
  }
  get balance(): Money {
    return this.state.balance;
  }
  get version(): number {
    return this.state.version;
  }
  get snapshot(): WalletState {
    return {
      ...this.state,
      createdAt: new Date(this.state.createdAt),
      updatedAt: new Date(this.state.updatedAt),
    };
  }
  move(money: Money, direction: LedgerDirection, transactionId: string): WalletLedgerEntry {
    if (!money.isPositive()) throw new DomainError("INVALID_AMOUNT");
    const before = this.balance;
    const after = direction === "CREDIT" ? before.add(money) : before.subtract(money);
    if (after.isNegative()) throw new DomainError("INSUFFICIENT_FUNDS");
    const now = new Date();
    const entry = WalletLedgerEntry.create({
      id: crypto.randomUUID(),
      walletId: this.id,
      transactionId,
      direction,
      money,
      balanceBefore: before,
      balanceAfter: after,
      createdAt: now,
    });
    this.state = { ...this.state, balance: after, version: this.version + 1, updatedAt: now };
    return entry;
  }
}

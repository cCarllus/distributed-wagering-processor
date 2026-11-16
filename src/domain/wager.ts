import { DomainError, Money, type MoneyProps } from "./money";
import { type LedgerDirection, Wallet, type WalletLedgerEntry } from "./wallet";
export type WagerKind = "OPENING" | "BET" | "WIN" | "LOSS" | "REFUND" | "ROLLBACK";
export type WagerStatus = "PENDING" | "PENDING_REFERENCE" | "PROCESSED" | "REJECTED" | "FAILED";
export interface WagerInput {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: Exclude<WagerKind, "OPENING">;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}
export interface WagerState {
  id: string;
  input: Omit<WagerInput, "kind"> & { kind: WagerKind };
  idempotencyKey: string;
  payloadHash: string;
  status: WagerStatus;
  referenceTransactionId?: string;
  failureCode?: string;
  resultBalance?: Money;
  createdAt: Date;
  processedAt?: Date;
  referenceAttempts: number;
  nextAttemptAt: Date;
  correlationId: string;
  causationId?: string;
}
export class WagerTransaction {
  private constructor(private state: WagerState) {
    this.state = {
      ...state,
      input: structuredClone(state.input),
      createdAt: new Date(state.createdAt),
      nextAttemptAt: new Date(state.nextAttemptAt),
      processedAt: state.processedAt ? new Date(state.processedAt) : undefined,
    };
  }
  static create(
    input: WagerInput,
    idempotencyKey: string,
    payloadHash: string,
    correlationId: string,
    causationId?: string,
  ): WagerTransaction {
    if (!["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"].includes(input.kind))
      throw new DomainError("INVALID_KIND");
    const money = Money.from(input.money);
    if (
      (input.kind === "REFUND" || input.kind === "ROLLBACK") &&
      !input.referenceExternalTransactionId
    )
      throw new DomainError("REFERENCE_REQUIRED");
    if (["BET", "LOSS"].includes(input.kind) && input.referenceExternalTransactionId)
      throw new DomainError("REFERENCE_NOT_ALLOWED");
    if (input.kind === "LOSS" ? !money.isZero() : !money.isPositive())
      throw new DomainError("INVALID_AMOUNT_FOR_KIND");
    const now = new Date();
    return new WagerTransaction({
      id: crypto.randomUUID(),
      input: structuredClone(input),
      idempotencyKey,
      payloadHash,
      correlationId,
      causationId,
      status: "PENDING",
      createdAt: now,
      referenceAttempts: 0,
      nextAttemptAt: now,
    });
  }
  static opening(wallet: Wallet): WagerTransaction {
    const now = new Date();
    return new WagerTransaction({
      id: crypto.randomUUID(),
      input: {
        providerId: "__system__",
        externalTransactionId: wallet.id,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "opening",
        gameId: "opening",
        kind: "OPENING",
        money: wallet.balance.toJSON(),
      },
      idempotencyKey: `opening:${wallet.id}`,
      payloadHash: "internal",
      correlationId: wallet.id,
      status: "PROCESSED",
      createdAt: now,
      processedAt: now,
      resultBalance: wallet.balance,
      referenceAttempts: 0,
      nextAttemptAt: now,
    });
  }
  static rehydrate(state: WagerState): WagerTransaction {
    return new WagerTransaction({ ...state, input: structuredClone(state.input) });
  }
  get snapshot(): WagerState {
    return {
      ...this.state,
      input: structuredClone(this.state.input),
      createdAt: new Date(this.state.createdAt),
      nextAttemptAt: new Date(this.state.nextAttemptAt),
      processedAt: this.state.processedAt ? new Date(this.state.processedAt) : undefined,
    };
  }
  get id(): string {
    return this.state.id;
  }
  get input(): WagerState["input"] {
    return structuredClone(this.state.input);
  }
  get status(): WagerStatus {
    return this.state.status;
  }
  get money(): Money {
    return Money.from(this.state.input.money);
  }
  isTerminal(): boolean {
    return ["PROCESSED", "REJECTED", "FAILED"].includes(this.status);
  }
  matchesPayload(hash: string): boolean {
    return this.state.payloadHash === hash;
  }
  private mutable(): void {
    if (this.isTerminal()) throw new DomainError("INVALID_TRANSACTION_STATE");
  }
  reject(code: string, wallet?: Wallet): void {
    this.mutable();
    this.state = {
      ...this.state,
      status: "REJECTED",
      failureCode: code,
      processedAt: new Date(),
      resultBalance: wallet?.balance,
    };
  }
  fail(code: string, wallet?: Wallet): void {
    this.mutable();
    this.state = {
      ...this.state,
      status: "FAILED",
      failureCode: code,
      processedAt: new Date(),
      resultBalance: wallet?.balance,
    };
  }
  defer(wallet: Wallet, baseMs: number): void {
    this.mutable();
    const attempts = this.state.referenceAttempts + 1;
    this.state = {
      ...this.state,
      status: "PENDING_REFERENCE",
      resultBalance: wallet.balance,
      referenceAttempts: attempts,
      nextAttemptAt: new Date(Date.now() + Math.min(baseMs * 2 ** (attempts - 1), 300000)),
    };
  }
  apply(
    wallet: Wallet | undefined,
    reference: WagerTransaction | undefined,
    alreadyReversed: boolean,
    maxAttempts: number,
    baseMs: number,
  ): WalletLedgerEntry | undefined {
    this.mutable();
    if (!wallet) {
      this.reject("WALLET_NOT_FOUND");
      return;
    }
    const p = this.input;
    if (
      this.status === "PENDING_REFERENCE" &&
      Date.now() - this.state.createdAt.getTime() >= 86400000
    ) {
      this.reject("REFERENCE_NOT_FOUND", wallet);
      return;
    }
    if (wallet.playerId !== p.playerId) {
      this.reject("PLAYER_MISMATCH", wallet);
      return;
    }
    if (wallet.currency !== p.money.currency) {
      this.reject("CURRENCY_MISMATCH", wallet);
      return;
    }
    if (p.referenceExternalTransactionId) {
      if (p.referenceExternalTransactionId === p.externalTransactionId) {
        this.reject("SELF_REFERENCE", wallet);
        return;
      }
      if (reference) {
        const r = reference.input;
        if (
          r.providerId !== p.providerId ||
          r.playerId !== p.playerId ||
          r.walletId !== p.walletId ||
          r.money.currency !== p.money.currency ||
          r.roundId !== p.roundId
        ) {
          this.reject("REFERENCE_MISMATCH", wallet);
          return;
        }
        if (p.kind === "ROLLBACK" ? !["BET", "WIN", "REFUND"].includes(r.kind) : r.kind !== "BET") {
          this.reject("REFERENCE_KIND_INVALID", wallet);
          return;
        }
        if (reference.isTerminal() && reference.status !== "PROCESSED") {
          this.reject("REFERENCE_NOT_PROCESSED", wallet);
          return;
        }
      }
      if (!reference || !reference.isTerminal()) {
        if (
          this.state.referenceAttempts >= maxAttempts ||
          Date.now() - this.state.createdAt.getTime() >= 86400000
        )
          this.reject("REFERENCE_NOT_FOUND", wallet);
        else this.defer(wallet, baseMs);
        return;
      }
      if (["REFUND", "ROLLBACK"].includes(p.kind)) {
        if (!this.money.equals(reference.money)) {
          this.reject("REVERSAL_AMOUNT_MISMATCH", wallet);
          return;
        }
        if (alreadyReversed) {
          this.reject("ALREADY_REVERSED", wallet);
          return;
        }
      }
    }
    let direction: LedgerDirection = p.kind === "BET" ? "DEBIT" : "CREDIT";
    if (p.kind === "ROLLBACK") direction = reference?.input.kind === "BET" ? "CREDIT" : "DEBIT";
    let entry: WalletLedgerEntry | undefined;
    try {
      if (p.kind !== "LOSS") entry = wallet.move(this.money, direction, this.id);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      this.reject(
        error.code === "INSUFFICIENT_FUNDS" && p.kind === "ROLLBACK"
          ? "REVERSAL_INSUFFICIENT_FUNDS"
          : error.code,
        wallet,
      );
      return;
    }
    this.state = {
      ...this.state,
      status: "PROCESSED",
      processedAt: new Date(),
      referenceTransactionId: reference?.id,
      resultBalance: wallet.balance,
    };
    return entry;
  }
  response(replay = false) {
    return {
      transactionId: this.id,
      status: this.status,
      balance: this.state.resultBalance?.toJSON() ?? null,
      failureCode: this.state.failureCode,
      idempotentReplay: replay,
    };
  }
}

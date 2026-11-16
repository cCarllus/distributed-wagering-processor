export interface MoneyProps {
  amount: string;
  currency: string;
}
export class DomainError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export class Money {
  static readonly MAX_CENTS = 9999999999999999n;
  private static readonly currencies = ["BRL", "USD", "EUR"] as const;
  private constructor(
    private readonly cents: bigint,
    public readonly currency: string,
  ) {
    Object.freeze(this);
  }
  static from(props: MoneyProps): Money {
    if (!Money.currencies.some((currency) => currency === props.currency))
      throw new DomainError("UNSUPPORTED_CURRENCY");
    if (typeof props.amount !== "string" || !/^(0|[1-9]\d{0,13})\.\d{2}$/.test(props.amount))
      throw new DomainError("INVALID_AMOUNT");
    return new Money(BigInt(props.amount.replace(".", "")), props.currency);
  }
  static rehydrate(cents: string | bigint, currency: string): Money {
    return new Money(BigInt(cents), currency);
  }
  static zero(currency: string): Money {
    return Money.from({ amount: "0.00", currency });
  }
  private same(other: Money): void {
    if (other.currency !== this.currency) throw new DomainError("CURRENCY_MISMATCH");
  }
  private result(cents: bigint): Money {
    if (cents > Money.MAX_CENTS || cents < -Money.MAX_CENTS)
      throw new DomainError("BALANCE_LIMIT_EXCEEDED");
    return new Money(cents, this.currency);
  }
  add(other: Money): Money {
    this.same(other);
    return this.result(this.cents + other.cents);
  }
  subtract(other: Money): Money {
    this.same(other);
    return this.result(this.cents - other.cents);
  }
  negate(): Money {
    return new Money(-this.cents, this.currency);
  }
  isZero(): boolean {
    return this.cents === 0n;
  }
  isPositive(): boolean {
    return this.cents > 0n;
  }
  isNegative(): boolean {
    return this.cents < 0n;
  }
  isLessThan(other: Money): boolean {
    this.same(other);
    return this.cents < other.cents;
  }
  equals(other: Money): boolean {
    this.same(other);
    return this.cents === other.cents;
  }
  toCents(): string {
    return this.cents.toString();
  }
  toString(): string {
    const abs = this.cents < 0n ? -this.cents : this.cents;
    return `${this.cents < 0n ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
  }
  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency };
  }
}

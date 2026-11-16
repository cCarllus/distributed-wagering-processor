export type Currency = "BRL" | "USD" | "EUR";
export type Money = { amount: string; currency: string };
export type Wallet = {
  id: string;
  playerId: string;
  balance: Money;
  version: number;
  createdAt?: string;
};
export type Kind = "BET" | "WIN" | "LOSS" | "REFUND" | "ROLLBACK";
export type Transaction = {
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  kind: Kind | "OPENING";
  status: string;
  money: Money;
  createdAt: string;
  failureCode?: string;
  balance?: Money | null;
  idempotentReplay?: boolean;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  roundId?: string;
  gameId?: string;
};
export type Result = {
  transactionId: string;
  status: string;
  balance: Money | null;
  failureCode?: string;
  idempotentReplay: boolean;
};
export type WagerBody = {
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  gameId: string;
  roundId: string;
  kind: Kind;
  money: Money;
  referenceExternalTransactionId?: string;
};
export type Draft = { key: string; body: WagerBody };
export type Page<T> = { items: T[]; nextCursor: string | null };
export type Overview = {
  balance: Money;
  wallets: number;
  transactions: number;
  processed: number;
  rejected: number;
  pending: number;
  failed: number;
  activity: { day: string; total: number }[];
  checkedAt: string;
};
export type Health = { api: boolean; postgres: boolean; sqs: boolean; checkedAt: string };
export type Operations = {
  outboxPending: number;
  outboxPublished: number;
  outboxRetries: number;
  oldestPendingAt: string | null;
  inbox: number;
  checkedAt: string;
};
export type Ledger = {
  id: string;
  transactionId: string;
  direction: string;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: string;
};
export type Reconciliation = {
  consistent: boolean;
  checkedEntries: number;
  storedBalance: Money;
  calculatedBalance: Money;
  difference: Money;
};
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
  get uncertain() {
    return this.status === 0 || this.status >= 500;
  }
}
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(path, {
      ...init,
      signal: AbortSignal.timeout(12000),
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const body = await response.json();
    if (!response.ok) throw new ApiError(body.code ?? `HTTP_${response.status}`, response.status);
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("CONNECTION_UNAVAILABLE", 0);
  }
}
/** 422/500 with a transaction ID are durable business decisions, not transport errors. */
export async function submit(
  draft: Draft,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<Result> {
  try {
    const response = await fetcher("/wagering/transactions", {
      method: "POST",
      signal: AbortSignal.timeout(12000),
      headers: { "Content-Type": "application/json", "Idempotency-Key": draft.key },
      body: JSON.stringify(draft.body),
    });
    const body = await response.json();
    if (
      [200, 202, 422, 500].includes(response.status) &&
      typeof body.transactionId === "string" &&
      typeof body.status === "string"
    )
      return body;
    throw new ApiError(body.code ?? `HTTP_${response.status}`, response.status);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("CONNECTION_UNAVAILABLE", 0);
  }
}
export function normalizeAmount(value: string): string {
  const normalized = value.replace(",", ".");
  if (!/^(0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(normalized))
    throw new Error("Use um valor positivo com até duas casas decimais, sem separador de milhar.");
  const [whole, fraction = ""] = normalized.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}
export function money(value: Money): string {
  const [whole = "0", fraction = "00"] = value.amount.split(".");
  const symbol =
    ({ BRL: "R$", USD: "US$", EUR: "€" } as Record<string, string>)[value.currency] ??
    value.currency;
  return `${symbol} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction}`;
}
export const short = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;
export const date = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
export const kindNames: Record<string, string> = {
  BET: "Aposta",
  WIN: "Prêmio",
  LOSS: "Perda",
  REFUND: "Reembolso",
  ROLLBACK: "Reversão",
  OPENING: "Abertura",
};
export const statusNames: Record<string, string> = {
  PROCESSED: "Processada",
  REJECTED: "Rejeitada",
  FAILED: "Falhou",
  PENDING: "Pendente",
  PENDING_REFERENCE: "Aguarda referência",
};
export function errorText(error: unknown): string {
  const codes: Record<string, string> = {
    CONNECTION_UNAVAILABLE: "Não foi possível conectar à API local.",
    INFRASTRUCTURE_UNAVAILABLE: "A infraestrutura está indisponível. Tente novamente.",
    WALLET_EXISTS: "Este jogador já possui uma carteira nesta moeda.",
    INVALID_PAYLOAD: "Confira os campos informados.",
    IDEMPOTENCY_CONFLICT: "Esta chave já foi usada com outros dados.",
    EXTERNAL_ID_CONFLICT: "Este ID externo já foi usado com outros dados.",
  };
  return error instanceof ApiError
    ? `${codes[error.code] ?? "A solicitação não pôde ser concluída."} (${error.code})`
    : error instanceof Error
      ? error.message
      : "Ocorreu um erro inesperado.";
}
const DRAFT_KEY = "jungle.local.wager.v1";
export function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return typeof d.key === "string" && d.body?.walletId && d.body?.money ? d : null;
  } catch {
    return null;
  }
}
export function saveDraft(draft: Draft | null) {
  // Persist before submitting. If storage is blocked, fail before any financial request.
  if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  else sessionStorage.removeItem(DRAFT_KEY);
}

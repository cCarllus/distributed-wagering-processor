import { createHash } from "node:crypto";
import { z } from "zod";
import type { WagerInput } from "../domain/wager";
export class ApplicationError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
  ) {
    super(code);
  }
}
const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
export const keySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
export const uuidSchema = z.uuid().transform((value) => value.toLowerCase());
export const moneySchema = z.strictObject({
  amount: z.string().regex(/^(0|[1-9]\d{0,13})\.\d{2}$/),
  currency: z.enum(["BRL", "USD", "EUR"]),
});
export const walletSchema = z.strictObject({ playerId: uuidSchema, initialBalance: moneySchema });
export const wagerSchema = z.strictObject({
  providerId: identifier.refine((v) => v !== "__system__"),
  externalTransactionId: identifier,
  playerId: uuidSchema,
  walletId: uuidSchema,
  roundId: identifier,
  gameId: identifier,
  kind: z.enum(["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"]),
  money: moneySchema,
  referenceExternalTransactionId: identifier.optional(),
});
export const messageSchema = z.strictObject({
  messageId: identifier,
  type: z.literal("WagerTransactionRequested"),
  occurredAt: z.iso.datetime(),
  data: wagerSchema.extend({ idempotencyKey: keySchema }),
});
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .filter((k) => object[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(object[k])}`)
    .join(",")}}`;
}
export function payloadHash(input: WagerInput): string {
  return hashValue(input);
}
export function hashValue(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApplicationError("INVALID_PAYLOAD", 400);
  return result.data;
}
export function dbCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) return String(error.code);
  return "INFRASTRUCTURE_UNAVAILABLE";
}
/** Unknown infrastructure failures are retried only within the bounded delivery budget. */
export function classifyFailure(error: unknown): "permanent" | "transient" {
  if (error instanceof ApplicationError) return "permanent";
  const code = dbCode(error);
  if (/^(22|23|42)/.test(code) || ["AccessDenied", "InvalidParameterValue"].includes(code))
    return "permanent";
  return "transient";
}

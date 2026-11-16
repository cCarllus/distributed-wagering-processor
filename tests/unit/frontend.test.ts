import { describe, expect, test } from "bun:test";
import {
  ApiError,
  type Draft,
  errorText,
  money,
  normalizeAmount,
  submit,
} from "../../frontend/src/api";

describe("frontend monetary and retry boundaries", () => {
  test("conflicts use the actual backend codes and retain diagnostic identifiers", () => {
    expect(errorText(new ApiError("WALLET_EXISTS", 409))).toBe(
      "Este jogador já possui uma carteira nesta moeda. (WALLET_EXISTS)",
    );
    expect(errorText(new ApiError("EXTERNAL_ID_CONFLICT", 409))).toBe(
      "Este ID externo já foi usado com outros dados. (EXTERNAL_ID_CONFLICT)",
    );
  });
  test("decimal strings remain exact at the maximum and in consolidated totals", () => {
    expect(normalizeAmount("99999999999999,99")).toBe("99999999999999.99");
    expect(normalizeAmount("0,1")).toBe("0.10");
    expect(normalizeAmount("10")).toBe("10.00");
    expect(money({ amount: "199999999999999.98", currency: "BRL" })).toBe(
      "R$ 199.999.999.999.999,98",
    );
    for (const invalid of [
      "1,001",
      "1.999",
      "1e3",
      "-1",
      "1.000,00",
      " 1",
      "01",
      "100000000000000.00",
      "",
      "NaN",
    ])
      expect(() => normalizeAmount(invalid)).toThrow();
  });
  const draft: Draft = {
    key: "web:stable-key",
    body: {
      walletId: crypto.randomUUID(),
      playerId: crypto.randomUUID(),
      providerId: "local",
      externalTransactionId: "same-external",
      gameId: "game",
      roundId: "round",
      kind: "BET",
      money: { amount: "80.00", currency: "BRL" },
    },
  };
  test("uncertain response retries identical body and idempotency key", async () => {
    const calls: RequestInit[] = [];
    const fetcher = async (_url: unknown, init: RequestInit) => {
      calls.push(init);
      return calls.length === 1
        ? Response.json({ code: "INFRASTRUCTURE_UNAVAILABLE" }, { status: 503 })
        : Response.json({
            transactionId: "durable-id",
            status: "PROCESSED",
            idempotentReplay: true,
            balance: { amount: "20.00", currency: "BRL" },
          });
    };
    await expect(submit(draft, fetcher)).rejects.toBeInstanceOf(ApiError);
    const replay = await submit(draft, fetcher);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.balance?.amount).toBe("20.00");
    expect(calls[0]!.body).toBe(calls[1]!.body);
    expect(calls[0]!.headers).toEqual(calls[1]!.headers);
    expect((calls[1]!.headers as Record<string, string>)["Idempotency-Key"]).toBe(draft.key);
  });
  test("durable rejected, pending and failed responses are not transport exceptions", async () => {
    for (const [status, http] of [
      ["REJECTED", 422],
      ["PENDING_REFERENCE", 202],
      ["FAILED", 500],
    ] as const) {
      const fetcher = async () =>
        Response.json(
          { transactionId: "durable", status, balance: null, idempotentReplay: false },
          { status: http },
        );
      expect((await submit(draft, fetcher)).status).toBe(status);
    }
  });
  test("conflict is explicit and a disconnected response stays uncertain", async () => {
    const conflict = async () => Response.json({ code: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
    await expect(submit(draft, conflict)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      uncertain: false,
    });
    const disconnected = async () => {
      throw new TypeError("offline");
    };
    await expect(submit(draft, disconnected)).rejects.toMatchObject({
      code: "CONNECTION_UNAVAILABLE",
      uncertain: true,
    });
  });
});

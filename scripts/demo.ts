export {};
// HTTP-only local demonstration; it does not connect to any external provider.
const base = "http://127.0.0.1:3100";
async function post(
  path: string,
  body: unknown,
  key?: string,
): Promise<Record<string, unknown> & { httpStatus: number }> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
    body: JSON.stringify(body),
  });
  return { httpStatus: response.status, ...((await response.json()) as Record<string, unknown>) };
}
const wallet = await post("/wallets", {
  playerId: crypto.randomUUID(),
  initialBalance: { amount: "100.00", currency: "BRL" },
});
if (wallet.httpStatus !== 201) throw new Error("Local wallet creation failed");
const operations = Array.from({ length: 2 }, () => ({
  providerId: "demo",
  externalTransactionId: crypto.randomUUID(),
  walletId: wallet.id,
  playerId: wallet.playerId,
  roundId: "round-demo",
  gameId: "game-demo",
  kind: "BET",
  money: { amount: "80.00", currency: "BRL" },
}));
const results = await Promise.all(
  operations.map((p) => post("/wagering/transactions", p, `demo:${p.externalTransactionId}`)),
);
const reconciliation = await post(`/wallets/${wallet.id}/reconciliation`, {});
console.log(JSON.stringify({ wallet, results, reconciliation }, null, 2));

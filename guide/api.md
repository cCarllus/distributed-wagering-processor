# 02 · API e mensagens

[Início](../README.md) · [01](../guide/iniciar.md) · **02 · API e mensagens** · [03](../guide/dashboard.md) · [04](../ARCHITECTURE.md) · [05](../guide/testes.md) · [06](../openspec/README.md)

## Dinheiro e operações

O contrato usa valores como `{ "amount": "25.00", "currency": "BRL" }`. Internamente, dinheiro é representado em centavos com `bigint`. A API aceita BRL, USD e EUR, sempre com duas casas e valor entre `0.00` e `99999999999999.99`. Floats, expoentes, sinais e escala incorreta são rejeitados, sem arredondamento.

| Operação | Efeito no saldo | Referência |
|---|---|---|
| BET | Débito | Não aceita |
| WIN | Crédito | BET opcional |
| LOSS | Sem movimentação; valor `0.00` | Não aceita |
| REFUND | Devolve o valor integral de uma BET | Obrigatória |
| ROLLBACK | Inverte integralmente BET, WIN ou REFUND | Obrigatória |

Reversões exigem o mesmo provedor, jogador, carteira, moeda e rodada. A unicidade é por **referência e tipo**, conforme o desafio: uma referência pode ter um REFUND e um ROLLBACK. `OPENING` é exclusivamente interno. Uma abertura com saldo positivo cria o crédito e seu registro na mesma transação; saldo zero não cria lançamento.

### Um exemplo pela API

Crie uma carteira e copie o `id` retornado:

```sh
curl -sS http://127.0.0.1:3100/wallets \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"100.00","currency":"BRL"}}'
```

Substitua `WALLET_ID` e envie a aposta:

```sh
curl -sS http://127.0.0.1:3100/wagering/transactions \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: provider-a:bet-1' \
  -H 'X-Correlation-Id: local-demo-1' \
  -d '{"providerId":"provider-a","externalTransactionId":"bet-1","playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","walletId":"WALLET_ID","roundId":"round-1","gameId":"game-1","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}'
```

Repetir esse POST devolve o mesmo ID e saldo da decisão, mesmo depois de outras movimentações. Para registrar uma operação diferente, use uma nova chave e um novo ID externo.

| Método | Rota | Uso |
|---|---|---|
| POST | `/wallets` | Criar carteira |
| GET | `/wallets/:id` | Consultar saldo atual |
| GET | `/wallets/:id/ledger?limit=50&cursor=…` | Extrato paginado |
| POST | `/wallets/:id/reconciliation` | Comparar saldo e ledger, sem corrigir |
| POST | `/wagering/transactions` | Submeter com `Idempotency-Key` obrigatório |
| GET | `/wagering/transactions/:id` | Consultar decisão pelo ID interno |
| GET | `/providers/:provider/wagering/transactions/:external` | Consultar pelo ID do provedor |
| GET | `/health/live`, `/health/ready`, `/metrics` | Saúde e métricas |

O extrato retorna `items` e `nextCursor`. O cursor conserva a posição e o limite superior da primeira página; lançamentos posteriores aparecem ao iniciar uma nova consulta.

| HTTP | Interpretação |
|---:|---|
| 201 | Carteira criada |
| 200 | Processada, replay ou consulta concluída |
| 202 | Referência pendente, já persistida |
| 400 / 404 | Contrato inválido / recurso não encontrado |
| 409 | Chave, ID externo ou carteira em conflito |
| 422 | Rejeição de negócio persistida, sem movimentação |
| 500 | Decisão FAILED persistida, com ID para investigação |
| 503 | Infraestrutura indisponível; repetir a mesma operação e chave |

Os códigos estáveis e a distinção entre resposta de transporte e decisão financeira estão na [arquitetura](../ARCHITECTURE.md#contrato-e-códigos-de-resposta).

### Entrada pela fila

A fila de entrada é `wager-transactions.fifo`; a DLQ é `wager-transactions-dlq.fifo`. A saída usa `wager-events.fifo`. O `MessageGroupId` é a wallet. O envelope usa os mesmos campos do POST, acrescidos da chave dentro de `data`:

```json
{
  "messageId": "msg-local-1",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-11-16T03:00:00.000Z",
  "data": {
    "providerId": "provider-a",
    "externalTransactionId": "bet-1",
    "idempotencyKey": "provider-a:bet-1",
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
    "roundId": "round-1",
    "gameId": "game-1",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }
}
```

`LocalSqs.send(INPUT_QUEUE, JSON.stringify(envelope), walletId, transportDedupId)` envia para o LocalStack. A suíte exercita esse caminho com o SDK real. Para testar reentrega além da janela de dedup do SQS, varie o `MessageDeduplicationId`; a deduplicação financeira continua no PostgreSQL.
---

← [Anterior: Começar](../guide/iniciar.md) &nbsp; · &nbsp; [Voltar ao início](../README.md) &nbsp; · &nbsp; [Próxima: Dashboard →](../guide/dashboard.md)

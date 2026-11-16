# Distributed Wagering Processor

Uma aposta de 80 em uma carteira com saldo 100 é simples. Duas apostas chegando ao mesmo tempo, uma mensagem entregue novamente e um processo caindo depois do commit tornam o problema mais interessante.

Este projeto resolve esses casos com uma API NestJS, PostgreSQL como fonte da verdade e workers sobre SQS local. HTTP e fila executam o mesmo caso de uso. Cada decisão fica registrada, o saldo pode ser reconstruído pelo extrato e uma repetição devolve o resultado original.

É uma implementação do [desafio da Jungle Gaming](https://github.com/junglegaming/backend-challenge/blob/c7143e6d041585d6913f56eb7415105e074f83dc/README.md), com uma dashboard opcional para explorar os fluxos. Tudo roda localmente, com jogadores, valores e credenciais fictícios.

![Dashboard com saldo consolidado, atividade e histórico](assets/dashboard-desktop.jpg)

## Rodando o projeto

Com Docker e Docker Compose instalados, a aplicação completa sobe com um comando:

```sh
docker compose --profile app up -d --build --wait
```

Abra **http://127.0.0.1:3100/**. O serviço `setup` aplica as migrations e cria as filas antes de iniciar a API e os workers. O banco começa vazio: crie uma carteira na interface ou execute `bun scripts/demo.ts` com Bun 1.3.14 instalado.

| Serviço | Endereço local |
|---|---|
| Dashboard e API | `http://127.0.0.1:3100` |
| PostgreSQL | `127.0.0.1:55432` |
| SQS / LocalStack | `http://127.0.0.1:4568` |
| Readiness | `http://127.0.0.1:3100/health/ready` |
| Prometheus | `http://127.0.0.1:3100/metrics` |

As portas publicadas ficam vinculadas a `127.0.0.1`. A API não implementa autenticação externa; o guard é um ponto de extensão, não uma proteção de acesso. Esta configuração não deve ser exposta na internet.

### Desenvolvimento com Bun

Para executar a aplicação fora do container e manter banco/fila no Compose:

```sh
bun install --frozen-lockfile --ignore-scripts
cp .env.example .env
docker compose up -d --wait postgres localstack
bun run migrate:up
bun run queues
bun run build:web
bun run start
```

Use apenas uma aplicação na porta 3100. Para separar API e workers, execute `WORKERS=false bun run start` em um terminal e `bun run worker` em outro. `bun run build` compila servidor e frontend; `bun run start:built` executa o servidor compilado com Bun. Depois de editar a interface, rode `bun run build:web` e recarregue a página.

Os defaults já correspondem ao `.env.example`: PostgreSQL `wager_local` / `wager_local_only` e AWS SDK `test` / `test`. A aplicação recusa destinos fora da configuração local e não descobre credenciais AWS do host.

### Stack

| Parte | Escolha |
|---|---|
| Runtime, pacotes e testes | Bun 1.3.14 |
| Linguagem / HTTP | TypeScript 5.9.3 strict / NestJS 11.1.9 |
| Persistência | PostgreSQL 17.6 / MikroORM 6.6.8 |
| Mensageria | SQS FIFO em LocalStack 4.9.2 |
| Interface | React 19.2.0, CSS e SVG locais, bundle com Bun |
| Qualidade | Biome 2.3.8, `bun test`, migrations versionadas |

Dependências diretas têm versões exatas e transitivas ficam no `bun.lock`. As imagens do Compose e do Dockerfile estão fixadas por versão e digest. Não há Prisma, CDN ou serviço de produção.

## Como uma transação atravessa o sistema

```mermaid
flowchart LR
    UI[Dashboard React] --> HTTP[API NestJS]
    SQ["SQS FIFO · LocalStack"] --> C[Consumer]
    HTTP --> U[ProcessWager]
    C --> U
    R[Worker de referências] --> U
    U --> DB[(PostgreSQL)]
    DB --> P[Outbox publisher]
    P --> E["Fila de eventos FIFO"]
    DB --> Q[Consultas e reconciliação]
    Q --> HTTP
```

Três escolhas sustentam o processamento:

- **Concorrência por carteira.** Um lock de linha serializa operações da mesma wallet. Carteiras diferentes continuam avançando em paralelo. Com duas apostas de 80 sobre saldo 100, apenas uma é debitada.
- **Idempotência persistente.** A chave HTTP e o par provedor/ID externo são ligados ao hash dos campos de negócio. Repetição compatível devolve a decisão gravada; payload divergente gera conflito.
- **Recuperação pelo banco.** Saldo, transação, ledger, inbox e outbox confirmam juntos. O ACK vem depois do commit; o publisher envia somente eventos confirmados. Uma republicação mantém o mesmo ID de evento para deduplicação pelo consumidor.

[ARCHITECTURE.md](ARCHITECTURE.md) detalha o fluxo, as constraints, os limites das garantias e as decisões de implementação.

## Operações e dinheiro

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

Os códigos estáveis e a distinção entre resposta de transporte e decisão financeira estão na [arquitetura](ARCHITECTURE.md#contrato-e-códigos-de-resposta).

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

## Explorando pela dashboard

A interface permite criar carteiras, enviar as cinco operações, filtrar transações, consultar a decisão original e percorrer o extrato. A tela de operação mostra saúde e contagens de inbox/outbox; essas contagens não representam o tamanho das filas.

Antes de enviar, o formulário salva corpo e chave em `sessionStorage`. Em timeout ou 503, o retry reutiliza ambos, inclusive após reload na mesma aba. Uma pendência confirmada permite iniciar outra operação para fornecer a referência que falta. A atualização geral é manual; o modal de pendência consulta o resultado automaticamente, sem requisições sobrepostas.

A apresentação usa navegação escura, amarelo nas ações e superfícies com profundidade discreta. Valores de moedas diferentes não são somados nem convertidos. O layout se adapta a desktop e celular, com tabelas que têm rolagem própria.

<p align="center">
  <img src="assets/dashboard-mobile.jpg" alt="Dashboard em viewport mobile" width="250" />
  <img src="assets/wallet-reconciliation.jpg" alt="Extrato e reconciliação de uma carteira" width="520" />
</p>

## Testes e verificação

A suíte completa usa PostgreSQL e SQS reais em containers. Ela recria somente `wager_test`, limpa as filas deste projeto, inicia processos nas portas 3211–3216 e interrompe temporariamente seu PostgreSQL para testar recuperação. Pare a demo durante a execução, pois ela compartilha essas filas.

```sh
bun install --frozen-lockfile --ignore-scripts
docker compose up -d --wait postgres localstack
docker compose stop app
bun run lint
bun run typecheck
bun run build
bun test --timeout 120000
docker compose --profile app up -d --build --wait
```

`bun run test:unit` executa apenas unidade; `bun run test:integration` exige os containers e o frontend já compilado. Ausência de infraestrutura causa falha, não aprovação ou skip. Logs dos processos de teste ficam em `.artifacts/tests/`, fora do Git.

A última validação funcional registrou **75 testes aprovados, 0 falhas e 1.744 verificações**: 34 testes unitários e 41 de integração. Inclui três processos Nest, 50 envios iguais, disputa por saldo, independência entre wallets, dois publishers, morte depois do commit e antes do ACK, retry/DLQ, referências fora de ordem, migrations up/down e reconciliação após cada cenário.

Também houve verificação real da dashboard no navegador, em desktop e viewport mobile: criação, cinco operações, replay, filtros, paginação, falha do banco e retomada. Essa inspeção é distinta da suíte automatizada. O resumo e a rastreabilidade estão no [OpenSpec](openspec/README.md).

## Onde encontrar cada parte

```text
frontend/src/                 Interface, formulários e cliente HTTP
src/domain/                   Money, wallet, transações, ledger e eventos
src/application/              Caso de uso compartilhado, contratos e portas
src/http/                     Controllers, respostas e ponto de extensão de auth
src/infrastructure/           MikroORM, migrations, consultas, SQS e métricas
src/workers/                  Consumer, referências, publisher e shutdown
tests/                        Unidade, integração e processos de crash
scripts/                      Build, migrations, filas e demonstração
openspec/specs/               Comportamento atual por capacidade
openspec/changes/archive/     Registros retrospectivos verificados
assets/                       Capturas usadas nesta documentação
```

O OpenSpec foi introduzido após a implementação, em 16/11/2026, para consolidar os contratos e cenários já verificados. As três mudanças arquivadas registram essa adoção retrospectiva. Novas alterações podem partir dessas specs.

A fonte do desafio foi conferida na revisão `c7143e6d041585d6913f56eb7415105e074f83dc`. O desenvolvimento teve assistência do Codex; não foram consultadas soluções de candidatos ou forks. As decisões e os limites permanecem explícitos para revisão técnica.

Para encerrar mantendo o banco, use `docker compose --profile app down`. Evite `down -v` se quiser preservar as carteiras. `bun run migrate:down` reverte a última migration; reverter também a migration base remove as tabelas financeiras. O LocalStack desta demo não persiste filas entre recriações.

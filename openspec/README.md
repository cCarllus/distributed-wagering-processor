# OpenSpec do projeto

Este catálogo foi iniciado com OpenSpec 1.13.1 em 16/11/2026, depois da implementação e da validação do sistema. As mudanças arquivadas são registros retrospectivos: consolidam contratos e cenários que já existiam, sem sugerir que as specs antecederam o código.

A fonte funcional é o [README oficial do desafio](https://github.com/junglegaming/backend-challenge/blob/c7143e6d041585d6913f56eb7415105e074f83dc/README.md), revisão `c7143e6d041585d6913f56eb7415105e074f83dc`. O desenvolvimento foi assistido pelo Codex; não foram utilizadas soluções de candidatos ou forks.

## Capacidades atuais

| Spec | Responsabilidade | Implementação / verificação |
|---|---|---|
| [money](specs/money/spec.md) | Precisão, escala, moeda, faixa e imutabilidade | `src/domain/money.ts`, `src/application/contracts.ts`; testes unitários de domínio e frontend |
| [wallet-ledger](specs/wallet-ledger/spec.md) | Abertura, lock por carteira, ledger e reconciliação | `store.ts`, `queries.ts`, migrations; integração de constraints, atomicidade e concorrência |
| [wager-rules](specs/wager-rules/spec.md) | Cinco operações e regras de referência/reversão | `src/domain/wager.ts`; unidade e integração |
| [idempotent-http](specs/idempotent-http/spec.md) | Contratos, identidades, aliases e saldo histórico | `process-wager.ts`, `contracts.ts`, `api.ts`; replay, conflito e três processos HTTP |
| [sqs-consumption](specs/sqs-consumption/spec.md) | Inbox, commit/ACK, retries, DLQ e shutdown | `consumer.ts`, `heartbeat.ts`, `sqs.ts`; crash, redelivery e falhas reais |
| [outbox-publication](specs/outbox-publication/spec.md) | Eventos, leases, fencing e republicação | `outbox.ts`, `events.ts`, `messages.ts`; dois publishers e recuperação |
| [pending-references](specs/pending-references/spec.md) | Trabalho fora de ordem, prazo e seleção por wallet | `references.ts`, `process-wager.ts`, `store.ts`; TTL, retomada e wallet ocupada |
| [observability](specs/observability/spec.md) | Logs, métricas, saúde e fronteira local | `telemetry.ts`, `config.ts`, `api.ts`; live/ready e métricas |
| [dashboard-console](specs/dashboard-console/spec.md) | Fluxos da interface e recuperação de envio | `frontend/src/`; unidade, contratos HTTP e inspeção real do navegador |
| [system-verification](specs/system-verification/spec.md) | Setup, testes reais e rastreabilidade | `package.json`, Compose, migrations, `tests/` e registros de verificação |

Os caminhos abreviados referem-se às áreas descritas no [README](../README.md). Os testes completos ficam em `tests/unit/` e `tests/integration/system.test.ts`.

## Registros arquivados

- [Núcleo financeiro](changes/archive/2026-11-16-record-financial-core/proposal.md): dinheiro, carteira/ledger, operações e HTTP idempotente.
- [Processamento distribuído](changes/archive/2026-11-16-record-distributed-processing/proposal.md): inbox, outbox, referências e observabilidade.
- [Dashboard e validação](changes/archive/2026-11-16-record-dashboard-and-qa/proposal.md): console, recuperação de falhas e verificação do conjunto.

Cada registro contém proposal, design, tarefas concluídas, delta specs e um resumo de verificação. O arquivamento sincroniza as specs principais em `openspec/specs/`.

## Checklist do desafio

1. Bun 1.x, TypeScript strict, NestJS, PostgreSQL, SQS local e Compose; ORM permitido, versões fixadas e migrations reversíveis — `system-verification`.
2. Dinheiro exato, faixa/escala/moeda validadas, sem arredondamento — `money`.
3. Domínio encapsulado com factories, invariantes e reidratação — `money`, `wallet-ledger`, `wager-rules`.
4. Saldo não negativo, wallet por jogador/moeda, identidade de operação e reversão única por tipo — `wallet-ledger`, `wager-rules`, `idempotent-http`.
5. Abertura positiva auditável no mesmo commit e OPENING externo proibido — `wallet-ledger`, `wager-rules`.
6. BET, WIN, LOSS, REFUND e ROLLBACK, valor integral e referências válidas — `wager-rules`.
7. Header obrigatório, hash canônico, conflito explícito e replay histórico — `idempotent-http`.
8. Criação/consulta de wallets, extrato com cursor, consulta interna/externa de transações, submissão e reconciliação — `idempotent-http`, `wallet-ledger`.
9. Validação, conflito, rejeição, pendência e falha transitória distintos — `idempotent-http`, `sqs-consumption`.
10. Concorrência por wallet, múltiplas instâncias e independência entre carteiras — `wallet-ledger`, `system-verification`.
11. Filas FIFO, mesmo caso de uso, inbox durável e ACK após commit — `sqs-consumption`.
12. Retry com backoff/limite, classificação de falhas, DLQ e shutdown — `sqs-consumption`.
13. Referências fora de ordem com agenda persistida, limite e desfecho — `pending-references`.
14. Saldo/transação/ledger/inbox/outbox atômicos e publisher recuperável — `wallet-ledger`, `outbox-publication`.
15. Eventos concretos versionados e ID estável; BalanceChanged só quando o saldo muda — `outbox-publication`.
16. Logs estruturados, correlação, métricas e liveness/readiness — `observability`.
17. Unidade e integração com infraestrutura real, migrations, constraints e falhas — `system-verification`.
18. Três processos, 50 duplicatas, duas apostas de 80 sobre 100, dois publishers, crash, redelivery e reinício — `system-verification`.
19. Reconstrução do ledger ao final dos cenários, reversões duplicadas e replay após outros movimentos — `wallet-ledger`, `wager-rules`, `idempotent-http`.
20. Setup, arquitetura, decisões e resultados verificáveis — README, ARCHITECTURE e este catálogo.
21. Dashboard opcional, acrescentada para demonstrar e inspecionar a API — `dashboard-console`.

### Critérios eliminatórios e respectivas provas

| Critério | Defesa / cenário |
|---|---|
| Dinheiro em number | Bigint/strings; teste acima da precisão segura de number |
| Race permite saldo negativo | Lock de wallet e constraints; duas apostas concorrentes de 80 sobre 100 |
| Efeito financeiro duplicado | Identidades SQL/inbox/ledger; 50 envios e redelivery |
| Idempotência só em memória | Tabelas permanentes; replay depois de reiniciar |
| Funciona somente em uma instância | Três processos Nest independentes |
| Publicação antes do commit | Outbox invisível durante transação ainda aberta |
| Ledger ausente ou mutável | Constraints, triggers, rejeição de UPDATE/DELETE/TRUNCATE e reconciliação |
| PostgreSQL/SQS substituídos integralmente por mocks | Containers reais; falhas injetadas apenas complementam a integração |

## Usando o catálogo

O CLI usado nesta consolidação foi a distribuição oficial `@fission-ai/openspec` 1.13.1, já instalada no ambiente. A documentação oficial está em [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec). Ele é uma ferramenta de documentação, não dependência do runtime.

```sh
OPENSPEC_TELEMETRY=0 openspec list --specs
OPENSPEC_TELEMETRY=0 openspec validate --all --strict --no-interactive
OPENSPEC_TELEMETRY=0 openspec validate --archived --strict --no-interactive

# Para trabalho novo, comece uma nova mudança:
OPENSPEC_TELEMETRY=0 openspec new change nome-da-mudanca
# Preencha proposal, design, specs e tasks; implemente e valide antes de arquivar.
OPENSPEC_TELEMETRY=0 openspec archive nome-da-mudanca --yes
```

As novas mudanças devem registrar intenção antes da implementação. Só marque tarefas concluídas com código ou validação observável; resultados de navegador, testes automatizados e aceitação de produção são categorias diferentes.

# Núcleo financeiro

## Why

Consolidar as regras de dinheiro, carteira, operações e idempotência que já foram implementadas e verificadas. O OpenSpec está sendo introduzido retrospectivamente em 16/11/2026, depois da implementação e dos testes; este registro não representa planejamento anterior ao código.

## What Changes

- Adicionar specs normativas para o comportamento existente.
- Ligar requisitos aos arquivos e cenários de verificação.
- Validar e arquivar a consolidação como baseline para futuras mudanças.

## Capabilities

### New Capabilities

Novas no catálogo OpenSpec, já existentes na aplicação:

- `money`: Represent monetary values exactly across domain, PostgreSQL and HTTP.
- `wallet-ledger`: Keep wallet balances auditable and protect each account with database invariants.
- `wager-rules`: Define the five wagering decisions, reference rules and terminal audit trail.
- `idempotent-http`: Expose financial contracts with persistent idempotency and historical replay results.

### Modified Capabilities

Nenhuma; este é o primeiro registro dessas capacidades.

## Impact

Documentação e organização do projeto. Locks por wallet, invariantes no domínio, constraints/ledger no PostgreSQL e resultado histórico persistido. Esta adoção não altera os contratos existentes.

Não há publicação da aplicação, mudança de regras financeiras ou integração de produção nesta adoção.

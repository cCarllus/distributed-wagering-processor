# Processamento distribuído

## Why

Registrar as garantias de consumo, publicação e recuperação já exercitadas com PostgreSQL e SQS locais. O OpenSpec está sendo introduzido retrospectivamente em 16/11/2026, depois da implementação e dos testes; este registro não representa planejamento anterior ao código.

## What Changes

- Adicionar specs normativas para o comportamento existente.
- Ligar requisitos aos arquivos e cenários de verificação.
- Validar e arquivar a consolidação como baseline para futuras mudanças.

## Capabilities

### New Capabilities

Novas no catálogo OpenSpec, já existentes na aplicação:

- `sqs-consumption`: Process at-least-once FIFO deliveries through the same financial use case as HTTP.
- `outbox-publication`: Publish committed versioned events with recoverable ownership and stable event IDs.
- `pending-references`: Resolve out-of-order references using durable bounded work owned by PostgreSQL.
- `observability`: Make processing, backlog and dependency health inspectable without exposing secrets.

### Modified Capabilities

Nenhuma; este é o primeiro registro dessas capacidades.

## Impact

Documentação e organização do projeto. Inbox e outbox no commit financeiro, ACK posterior, leases com fencing e trabalho de referência persistido. Os cenários de falha delimitam at-least-once e os limites de ordenação.

Não há publicação da aplicação, mudança de regras financeiras ou integração de produção nesta adoção.

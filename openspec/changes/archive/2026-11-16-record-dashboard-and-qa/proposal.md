# Dashboard e validação

## Why

Consolidar os fluxos da interface e a verificação do sistema, incluindo as correções encontradas no QA real. O OpenSpec está sendo introduzido retrospectivamente em 16/11/2026, depois da implementação e dos testes; este registro não representa planejamento anterior ao código.

## What Changes

- Adicionar specs normativas para o comportamento existente.
- Ligar requisitos aos arquivos e cenários de verificação.
- Validar e arquivar a consolidação como baseline para futuras mudanças.

## Capabilities

### New Capabilities

Novas no catálogo OpenSpec, já existentes na aplicação:

- `dashboard-console`: Operate and inspect the local simulation through a responsive same-origin console.
- `system-verification`: Keep the local challenge reproducible and distinguish executed validation from design intent.

### Modified Capabilities

Nenhuma; este é o primeiro registro dessas capacidades.

## Impact

Documentação e organização do projeto. Frontend na mesma origem, valores exatos, snapshot de retry na aba, polling serial e reconciliação sem sucesso obsoleto. Validar a reorganização sem alterar comportamento financeiro.

Não há publicação da aplicação, mudança de regras financeiras ou integração de produção nesta adoção.

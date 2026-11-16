# Decisões registradas — Processamento distribuído

## Context

Registro retrospectivo de 16/11/2026, baseado na implementação local, revisão crítica e testes concluídos. Fonte do desafio: revisão `c7143e6d041585d6913f56eb7415105e074f83dc`.

## Goals / Non-goals

Consolidar contratos observáveis e cenários reproduzíveis; preservar rastreabilidade sem manter logs brutos no repositório. Não retroagir datas, inventar planejamento anterior ou declarar aceitação em produção.

## Decisions

Inbox e outbox no commit financeiro, ACK posterior, leases com fencing e trabalho de referência persistido. Os cenários de falha delimitam at-least-once e os limites de ordenação.

O detalhamento transversal está em `ARCHITECTURE.md`. Cada delta spec aponta os arquivos responsáveis e a verificação correspondente.

## Risks / Trade-offs

A baseline descreve o estado verificado, mas não substitui execução de testes em outro ambiente. O broker continua at-least-once; autenticação externa, carga e implantação de produção estão fora do escopo. A inspeção do navegador não é uma suíte automatizada cross-browser.

## Migration Plan

Validar os deltas, conferir implementação e testes, arquivar via CLI e validar novamente as specs principais. Nenhuma migration financeira é introduzida.

## Open Questions

Nenhuma pendência para esta consolidação local. Mudanças futuras de regras ou ambiente exigem novas propostas.

# 01 · Começar

[Início](../README.md) · **01 · Começar** · [02](../guide/api.md) · [03](../guide/dashboard.md) · [04](../ARCHITECTURE.md) · [05](../guide/testes.md) · [06](../openspec/README.md)

Clone o repositório com sua conta GitHub autorizada e entre na pasta:

```sh
git clone https://github.com/cCarllus/distributed-wagering-processor.git
cd distributed-wagering-processor
```

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

## Encerrar e preservar os dados

Para encerrar mantendo o banco, use `docker compose --profile app down`. Evite `down -v` se quiser preservar as carteiras. `bun run migrate:down` reverte a última migration; reverter também a migration base remove as tabelas financeiras. O LocalStack desta demo não persiste filas entre recriações.

---

[Voltar ao início](../README.md) &nbsp; · &nbsp; [Próxima: API e mensagens →](../guide/api.md)

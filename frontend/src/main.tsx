import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  type Currency,
  date,
  type Health,
  kindNames,
  money,
  type Operations,
  type Overview,
  type Page,
  short,
  type Transaction,
  type Wallet,
} from "./api";
import { Empty, ErrorBox, Icon, type IconName, Loading, Status, useResource } from "./components";
import { CreateWallet, SubmitWager, TransactionDetail, WalletDetail } from "./forms";
import "./styles.css";

type View = "overview" | "wallets" | "transactions" | "operations";
const navigation: { id: View; label: string; icon: IconName }[] = [
  { id: "overview", label: "Visão geral", icon: "grid" },
  { id: "wallets", label: "Carteiras", icon: "wallet" },
  { id: "transactions", label: "Transações", icon: "arrows" },
  { id: "operations", label: "Operação", icon: "pulse" },
];
function TransactionTable({
  items,
  onSelect,
}: {
  items: Transaction[];
  onSelect: (id: string) => void;
}) {
  return items.length ? (
    <div className="table-wrap">
      <table className="transactions-table">
        <thead>
          <tr>
            <th>Transação / provedor</th>
            <th>Operação</th>
            <th>Valor</th>
            <th>Status</th>
            <th>Quando</th>
            <th>
              <span className="sr-only">Detalhes</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((tx) => (
            <tr key={tx.transactionId}>
              <td>
                <button
                  type="button"
                  className="row-link"
                  onClick={() => onSelect(tx.transactionId)}
                >
                  {tx.externalTransactionId.length > 24
                    ? short(tx.externalTransactionId)
                    : tx.externalTransactionId}
                </button>
                <small>{tx.providerId === "__system__" ? "Sistema local" : tx.providerId}</small>
              </td>
              <td>
                <span className={`kind-icon ${tx.kind.toLowerCase()}`}>
                  <Icon
                    name={tx.kind === "BET" ? "arrow" : tx.kind === "LOSS" ? "close" : "arrows"}
                    size={15}
                  />
                </span>
                {kindNames[tx.kind]}
              </td>
              <td className="amount">{money(tx.money)}</td>
              <td>
                <Status status={tx.status} />
              </td>
              <td className="date-cell">{date(tx.createdAt)}</td>
              <td>
                <button
                  type="button"
                  className="icon-button small"
                  aria-label={`Detalhes da transação ${tx.externalTransactionId}`}
                  onClick={() => onSelect(tx.transactionId)}
                >
                  <Icon name="chevron" size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="Nenhuma transação encontrada" icon="arrows">
      Não há operações para os filtros selecionados.
    </Empty>
  );
}
function SystemHealth({
  health,
  error,
  compact = false,
}: {
  health?: Health;
  error?: string;
  compact?: boolean;
}) {
  const entries = [
    { name: "API NestJS", ok: health?.api },
    { name: "PostgreSQL", ok: health?.postgres },
    { name: "SQS · LocalStack", ok: health?.sqs },
  ];
  return (
    <div className={`system-health ${compact ? "compact" : ""}`}>
      {entries.map((item) => (
        <div key={item.name}>
          <span>{item.name}</span>
          <span
            className={`service-state ${item.ok === true ? "online" : item.ok === false || error ? "offline" : "unknown"}`}
          >
            <i />
            {item.ok === true
              ? "Disponível"
              : item.ok === false || error
                ? "Indisponível"
                : "Verificando"}
          </span>
        </div>
      ))}
    </div>
  );
}
function Activity({
  data,
  days,
  onDays,
}: {
  data: Overview;
  days: string;
  onDays: (value: string) => void;
}) {
  const maximum = Math.max(1, ...data.activity.map((d) => d.total));
  const total = data.activity.reduce((sum, d) => sum + d.total, 0);
  return (
    <section className="panel activity-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">VOLUME DE OPERAÇÕES</span>
          <h2>Atividade de transações</h2>
        </div>
        <select
          className="compact-select"
          aria-label="Período do gráfico"
          value={days}
          onChange={(e) => onDays(e.target.value)}
        >
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
        </select>
      </div>
      <div className="chart-summary">
        <strong>{total.toLocaleString("pt-BR")}</strong>
        <span>operações no período</span>
        <span className="chart-legend">
          <i />
          Transações recebidas
        </span>
      </div>
      <div
        className={`bar-chart days-${days}`}
        role="img"
        aria-label={data.activity.map((d) => `${d.day}: ${d.total} transações`).join("; ")}
      >
        <div className="chart-grid">
          <span>{maximum}</span>
          <span>{Math.round(maximum / 2)}</span>
          <span>0</span>
        </div>
        <div className="chart-bars">
          {data.activity.map((d, index) => (
            <div
              className={`chart-column ${index === data.activity.length - 1 ? "today" : ""}`}
              key={d.day}
            >
              <div className="bar-track">
                <div
                  className="chart-bar"
                  style={{
                    height: `${(d.total / maximum) * 100}%`,
                    minHeight: d.total ? "5px" : "0",
                  }}
                >
                  <span className="bar-tooltip">{d.total}</span>
                </div>
              </div>
              <span className="bar-label">
                {days === "7"
                  ? new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" })
                      .format(new Date(`${d.day}T12:00:00Z`))
                      .replace(".", "")
                  : index % 5 === 0 || index === data.activity.length - 1
                    ? d.day.slice(-2)
                    : ""}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="chart-footer">
        <span>
          <Icon name="clock" size={14} /> Horário de Brasília
        </span>
        <span>Inclui todas as decisões · exclui aberturas</span>
      </div>
    </section>
  );
}
function OverviewView({
  currency,
  revision,
  onView,
  onTransaction,
  health,
  healthError,
}: {
  currency: Currency;
  revision: number;
  onView: (v: View) => void;
  onTransaction: (id: string) => void;
  health?: Health;
  healthError?: string;
}) {
  const [days, setDays] = useState("7");
  const overview = useResource<Overview>(
    `/dashboard/overview?currency=${currency}&days=${days}`,
    revision,
  );
  const recent = useResource<Page<Transaction>>(
    `/dashboard/transactions?currency=${currency}&limit=5`,
    revision,
  );
  const data = overview.data;
  return (
    <>
      {overview.error && <ErrorBox message={overview.error} />}
      <div className="stats-grid">
        <article className="stat-card balance-card">
          <div className="stat-heading">
            <span>Saldo consolidado</span>
            <span className="mini-clay">
              <Icon name="wallet" />
            </span>
          </div>
          <strong className="balance-value">{data ? money(data.balance) : "—"}</strong>
          <div className="stat-footer">
            <span className="tiny-dot" /> Saldo consolidado em {currency}
          </div>
        </article>
        <article className="stat-card">
          <div className="stat-heading">
            <span>Carteiras cadastradas</span>
            <span className="mini-clay">
              <Icon name="wallet" />
            </span>
          </div>
          <strong>{data ? data.wallets.toLocaleString("pt-BR") : "—"}</strong>
          <button
            type="button"
            className="stat-footer text-button"
            onClick={() => onView("wallets")}
          >
            Consultar carteiras
            <Icon name="arrow" size={14} />
          </button>
        </article>
        <article className="stat-card">
          <div className="stat-heading">
            <span>Transações</span>
            <span className="mini-clay">
              <Icon name="arrows" />
            </span>
          </div>
          <strong>{data ? data.transactions.toLocaleString("pt-BR") : "—"}</strong>
          <div className="stat-footer">
            {data
              ? `${data.processed} processadas · ${data.rejected} rejeitadas`
              : "Consultando histórico"}
          </div>
        </article>
        <article className="stat-card">
          <div className="stat-heading">
            <span>Em processamento</span>
            <span className="mini-clay">
              <Icon name="clock" />
            </span>
          </div>
          <strong>{data ? data.pending.toLocaleString("pt-BR") : "—"}</strong>
          <div className="stat-footer">
            {data
              ? data.pending
                ? "Aguardando decisão ou referência"
                : "Nenhuma operação pendente"
              : "Consultando operações"}
          </div>
        </article>
      </div>
      <div className="middle-grid">
        {data ? (
          <Activity data={data} days={days} onDays={setDays} />
        ) : (
          <section className="panel">
            {overview.loading ? (
              <Loading />
            ) : (
              <Empty title="Gráfico indisponível">Atualize os dados quando a conexão voltar.</Empty>
            )}
          </section>
        )}
        <aside className="panel distribution-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">HISTÓRICO COMPLETO</span>
              <h2>Status das transações</h2>
            </div>
          </div>
          {data ? (
            <>
              <div className="distribution-total">
                <strong>{data.transactions.toLocaleString("pt-BR")}</strong>
                <span>transações em {currency}</span>
              </div>
              <div className="distribution-bar" aria-hidden="true">
                {[
                  { name: "processed", count: data.processed },
                  { name: "rejected", count: data.rejected },
                  { name: "pending", count: data.pending },
                  { name: "failed", count: data.failed },
                ].map((item) => (
                  <span
                    key={item.name}
                    className={item.name}
                    style={{
                      width: `${data.transactions ? (item.count / data.transactions) * 100 : 0}%`,
                    }}
                  />
                ))}
              </div>
              <dl className="distribution-list">
                {[
                  { name: "Processadas", tone: "processed", count: data.processed },
                  { name: "Rejeitadas", tone: "rejected", count: data.rejected },
                  { name: "Pendentes", tone: "pending", count: data.pending },
                  { name: "Falhas", tone: "failed", count: data.failed },
                ].map((item) => (
                  <div key={item.tone}>
                    <dt>
                      <i className={item.tone} />
                      {item.name}
                    </dt>
                    <dd>{item.count.toLocaleString("pt-BR")}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : overview.loading ? (
            <Loading />
          ) : (
            <p className="field-hint">Dados indisponíveis.</p>
          )}
          <button type="button" className="text-button" onClick={() => onView("transactions")}>
            Consultar transações
            <Icon name="arrow" size={16} />
          </button>
        </aside>
      </div>
      <div className="bottom-grid">
        <section className="panel recent-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">HISTÓRICO</span>
              <h2>Transações recentes</h2>
            </div>
            <button type="button" className="text-button" onClick={() => onView("transactions")}>
              Ver todas
              <Icon name="chevron" size={16} />
            </button>
          </div>
          {recent.loading && <Loading />}
          {recent.error && <ErrorBox message={recent.error} />}{" "}
          {recent.data && <TransactionTable items={recent.data.items} onSelect={onTransaction} />}
        </section>
        <section className="panel health-panel">
          <span className="clay-icon">
            <Icon name="pulse" size={24} />
          </span>
          <h2>Disponibilidade</h2>
          <p>Status dos serviços locais.</p>
          <SystemHealth health={health} error={healthError} compact />
          <button type="button" className="text-button" onClick={() => onView("operations")}>
            Detalhes da operação
            <Icon name="arrow" size={16} />
          </button>
        </section>
      </div>
      {overview.loading && (
        <span className="sr-only" aria-live="polite">
          Atualizando resumo
        </span>
      )}
    </>
  );
}
function WalletsView({
  currency,
  revision,
  onCreate,
  onSelect,
}: {
  currency: Currency;
  revision: number;
  onCreate: () => void;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState("");
  const { data, loading, error } = useResource<Page<Wallet>>(
    `/dashboard/wallets?currency=${currency}&query=${encodeURIComponent(search)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    revision,
  );
  return (
    <section className="panel list-panel">
      <div className="list-toolbar">
        <div className="search-field">
          <Icon name="search" />
          <input
            aria-label="Buscar carteiras"
            placeholder="Buscar por ID da carteira ou jogador"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCursor("");
            }}
          />
        </div>
        <button type="button" className="button primary" onClick={onCreate}>
          <Icon name="plus" size={18} />
          Criar carteira
        </button>
      </div>
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}{" "}
      {data &&
        (data.items.length ? (
          <div className="wallet-grid">
            {data.items.map((w) => (
              <button
                key={w.id}
                type="button"
                className="wallet-card"
                onClick={() => onSelect(w.id)}
              >
                <div className="wallet-card-top">
                  <span className="clay-icon">
                    <Icon name="wallet" size={25} />
                  </span>
                  <span className="currency-tag">{w.balance.currency}</span>
                </div>
                <span className="eyebrow">SALDO DISPONÍVEL</span>
                <strong>{money(w.balance)}</strong>
                <span className="wallet-id">Carteira {short(w.id)}</span>
                <div className="wallet-card-bottom">
                  <span>Jogador {short(w.playerId)}</span>
                  <Icon name="arrow" size={18} />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Empty
            title={search ? "Nenhuma carteira encontrada" : "Nenhuma carteira cadastrada"}
            icon="wallet"
          >
            {search
              ? "Tente outro ID ou altere a moeda selecionada."
              : "Cadastre uma carteira para registrar as operações nesta moeda."}
          </Empty>
        ))}
      <Pagination next={data?.nextCursor} cursor={cursor} onCursor={setCursor} />
    </section>
  );
}
function TransactionsView({
  currency,
  revision,
  onSelect,
}: {
  currency: Currency;
  revision: number;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [cursor, setCursor] = useState("");
  const params = new URLSearchParams({ currency, query: search });
  if (status) params.set("status", status);
  if (kind) params.set("kind", kind);
  if (cursor) params.set("cursor", cursor);
  const { data, loading, error } = useResource<Page<Transaction>>(
    `/dashboard/transactions?${params}`,
    revision,
  );
  return (
    <section className="panel list-panel">
      <div className="list-toolbar">
        <div className="search-field">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Buscar transações"
            placeholder="Buscar ID ou provedor"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCursor("");
            }}
          />
        </div>
        <div className="filters">
          <select
            aria-label="Filtrar status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setCursor("");
            }}
          >
            <option value="">Todos os status</option>
            <option value="PROCESSED">Processadas</option>
            <option value="REJECTED">Rejeitadas</option>
            <option value="PENDING_REFERENCE">Aguardando referência</option>
            <option value="PENDING">Pendentes</option>
            <option value="FAILED">Falhas</option>
          </select>
          <select
            aria-label="Filtrar operação"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setCursor("");
            }}
          >
            <option value="">Todas as operações</option>
            {Object.entries(kindNames).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}{" "}
      {data && <TransactionTable items={data.items} onSelect={onSelect} />}
      <Pagination next={data?.nextCursor} cursor={cursor} onCursor={setCursor} />
      <p className="table-note">
        Horários de Brasília · valores na moeda selecionada · clique em uma transação para ver a
        decisão original.
      </p>
    </section>
  );
}
function Pagination({
  next,
  cursor,
  onCursor,
}: {
  next?: string | null;
  cursor: string;
  onCursor: (cursor: string) => void;
}) {
  return (
    <div className="pagination">
      <span>{cursor ? "Continuação dos resultados" : "Mais recentes primeiro"}</span>
      <div>
        {cursor && (
          <button type="button" className="button secondary" onClick={() => onCursor("")}>
            Voltar ao início
          </button>
        )}
        {next && (
          <button type="button" className="button secondary" onClick={() => onCursor(next)}>
            Próxima página
            <Icon name="chevron" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
function OperationsView({
  revision,
  health,
  healthError,
}: {
  revision: number;
  health?: Health;
  healthError?: string;
}) {
  const { data, loading, error } = useResource<Operations>("/dashboard/operations", revision);
  return (
    <>
      <div className="operation-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">INFRAESTRUTURA LOCAL</span>
              <h2>Serviços conectados</h2>
            </div>
            <span className="clay-icon">
              <Icon name="pulse" />
            </span>
          </div>
          <SystemHealth health={health} error={healthError} />
          <p className="field-hint">
            Verificação ativa de conexão ao banco e às filas. Não mede latência ou disponibilidade
            histórica.
          </p>
        </section>
        <section className="panel">
          <span className="eyebrow">OBSERVABILIDADE</span>
          <h2>Mensageria</h2>
          <p className="body-copy">
            A inbox registra entregas recebidas. A outbox guarda eventos confirmados no banco até a
            publicação na fila local.
          </p>
          <a className="button secondary" href="/metrics" target="_blank" rel="noreferrer">
            Abrir métricas Prometheus
            <Icon name="external" size={16} />
          </a>
        </section>
      </div>
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}{" "}
      {data && (
        <div className="stats-grid operation-stats">
          {[
            {
              label: "Mensagens na inbox",
              value: data.inbox,
              hint: "Registros duráveis recebidos",
              icon: "arrows",
            },
            {
              label: "Eventos publicados",
              value: data.outboxPublished,
              hint: "Publicação registrada na outbox",
              icon: "check",
            },
            {
              label: "Publicação pendente",
              value: data.outboxPending,
              hint: "Eventos ainda não confirmados",
              icon: "clock",
            },
            {
              label: "Pendentes com tentativas",
              value: data.outboxRetries,
              hint: "Podem incluir publicações em curso",
              icon: "refresh",
            },
          ].map((s) => (
            <article className="stat-card" key={s.label}>
              <div className="stat-heading">
                <span>{s.label}</span>
                <span className="mini-clay">
                  <Icon name={s.icon as IconName} />
                </span>
              </div>
              <strong>{s.value}</strong>
              <div className="stat-footer">{s.hint}</div>
            </article>
          ))}
        </div>
      )}
      <section className="panel operation-notes">
        <span className="eyebrow">GARANTIAS E LIMITES</span>
        <h2>Regras de processamento</h2>
        <div className="guarantees">
          <div>
            <span>01</span>
            <h3>Concorrência por carteira</h3>
            <p>
              O bloqueio acontece no PostgreSQL por carteira. Carteiras diferentes continuam
              avançando em paralelo.
            </p>
          </div>
          <div>
            <span>02</span>
            <h3>Idempotência</h3>
            <p>
              Chaves e decisões persistidas evitam novos débitos em reenvios. Payload divergente
              gera conflito.
            </p>
          </div>
          <div>
            <span>03</span>
            <h3>Recuperação após falha</h3>
            <p>
              Eventos são publicados após o commit. Pode haver republicação: consumidores deduplicam
              pelo ID do evento.
            </p>
          </div>
        </div>
        <p className="table-note">
          Contagens globais, de todas as moedas.{" "}
          {data?.oldestPendingAt
            ? `Evento pendente mais antigo: ${date(data.oldestPendingAt)}.`
            : data
              ? "Nenhum evento aguarda publicação no momento da consulta."
              : "Aguardando consulta da outbox."}{" "}
          Não representam o tamanho das filas ou da DLQ.
        </p>
      </section>
    </>
  );
}
function App() {
  const [view, setView] = useState<View>("overview");
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [revision, setRevision] = useState(0);
  const [modal, setModal] = useState<"wallet" | "wager" | null>(null);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [wagerWallet, setWagerWallet] = useState<Wallet>();
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const health = useResource<Health>("/dashboard/health", revision);
  const ready = health.data?.api && health.data.postgres && health.data.sqs;
  const titles = {
    overview: ["Visão geral", "Posição consolidada e acompanhamento das transações."],
    wallets: ["Carteiras", "Saldos, titulares e histórico de movimentações."],
    transactions: ["Transações", "Consulta de operações e decisões de processamento."],
    operations: ["Operação", "Disponibilidade dos serviços e publicação de eventos."],
  };
  function refresh() {
    setRevision((v) => v + 1);
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          type="button"
          className="brand"
          onClick={() => setView("overview")}
          aria-label="Jungle Console, visão geral"
        >
          <span className="brand-mark" aria-hidden="true">
            j<span>.</span>
          </span>
          <span>
            <strong>JUNGLE</strong>
            <small>CONSOLE FINANCEIRO</small>
          </span>
        </button>
        <div className="sidebar-label">GESTÃO FINANCEIRA</div>
        <nav aria-label="Navegação principal">
          {navigation.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setView(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-dot" />
            <span>
              Ambiente local<small>Operações simuladas</small>
            </span>
            <Icon name="shield" size={17} />
          </div>
          <div className="profile">
            <span className="avatar">CH</span>
            <div>
              <strong>Carlos Henrique</strong>
              <small>Desenvolvimento</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Console <span>/</span> <strong>{navigation.find((n) => n.id === view)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="simulation-badge">
              <span />
              Ambiente simulado
            </span>
            <span className="topbar-divider" />
            <span className="small-avatar">CH</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">JUNGLE GAMING</span>
              <h1>{titles[view][0]}</h1>
              <p>{titles[view][1]}</p>
            </div>
            <div className="heading-actions">
              <label className="currency-selector">
                <span className="sr-only">Moeda do painel</span>
                <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                  <option value="BRL">R$ · BRL</option>
                  <option value="USD">$ · USD</option>
                  <option value="EUR">€ · EUR</option>
                </select>
              </label>
              {view === "overview" && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setModal("wallet")}
                >
                  Criar carteira
                </button>
              )}
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  setWagerWallet(undefined);
                  setModal("wager");
                }}
              >
                <Icon name="plus" size={18} />
                Nova transação
              </button>
            </div>
          </div>
          <div className="context-row">
            <span
              className={`connection ${ready ? "connected" : health.loading ? "checking" : "disconnected"}`}
            >
              <span />
              {ready
                ? "Serviços conectados"
                : health.loading
                  ? "Verificando serviços"
                  : "Verifique os serviços locais"}
            </span>
            <button
              type="button"
              className="text-button refresh-button"
              onClick={refresh}
              disabled={health.loading}
            >
              <Icon name="refresh" size={14} />
              {health.data
                ? `Atualizado às ${new Date(health.data.checkedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}`
                : "Atualizar dados"}
            </button>
          </div>
          {notice && (
            <div className="toast" aria-live="polite">
              <Icon name="check" size={18} />
              {notice}
              <button
                type="button"
                className="icon-button small"
                aria-label="Dispensar aviso"
                onClick={() => setNotice("")}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          )}
          {view === "overview" && (
            <OverviewView
              currency={currency}
              revision={revision}
              onView={setView}
              onTransaction={setTransactionId}
              health={health.data}
              healthError={health.error}
            />
          )}
          {view === "wallets" && (
            <WalletsView
              key={currency}
              currency={currency}
              revision={revision}
              onCreate={() => setModal("wallet")}
              onSelect={setWalletId}
            />
          )}
          {view === "transactions" && (
            <TransactionsView
              key={currency}
              currency={currency}
              revision={revision}
              onSelect={setTransactionId}
            />
          )}
          {view === "operations" && (
            <OperationsView revision={revision} health={health.data} healthError={health.error} />
          )}
          <footer className="page-footer">
            <span>
              Jungle Gaming <span className="footer-separator">/</span> Console financeiro
            </span>
            <span>
              Ambiente local <i /> Valores simulados
            </span>
          </footer>
        </main>
      </div>
      {modal === "wallet" && (
        <CreateWallet
          currency={currency}
          onClose={() => setModal(null)}
          onCreated={(w) => {
            setModal(null);
            setCurrency(w.balance.currency as Currency);
            setNotice("Carteira criada. O saldo inicial está registrado no ledger.");
            refresh();
            setWalletId(w.id);
          }}
        />
      )}
      {modal === "wager" && (
        <SubmitWager
          currency={(wagerWallet?.balance.currency as Currency) ?? currency}
          initialWallet={wagerWallet}
          onClose={() => setModal(null)}
          onChanged={refresh}
        />
      )}
      {walletId && (
        <WalletDetail
          id={walletId}
          revision={revision}
          onClose={() => setWalletId(null)}
          onWager={(w) => {
            setWalletId(null);
            setWagerWallet(w);
            setModal("wager");
          }}
        />
      )}
      {transactionId && (
        <TransactionDetail id={transactionId} onClose={() => setTransactionId(null)} />
      )}
    </div>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(<App />);

import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  type Currency,
  type Draft,
  date,
  errorText,
  type Kind,
  kindNames,
  type Ledger,
  money,
  normalizeAmount,
  type Page,
  type Reconciliation,
  type Result,
  readDraft,
  request,
  saveDraft,
  short,
  submit,
  type Transaction,
  type Wallet,
} from "./api";
import { Copy, Empty, ErrorBox, Icon, Loading, Modal, Status, useResource } from "./components";

export function CreateWallet({
  currency,
  onClose,
  onCreated,
}: {
  currency: Currency;
  onClose: () => void;
  onCreated: (w: Wallet) => void;
}) {
  const [player, setPlayer] = useState(() => crypto.randomUUID() as string);
  const [amount, setAmount] = useState("100,00");
  const [selectedCurrency, setCurrency] = useState(currency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(false);
  return (
    <Modal title="Nova carteira" eyebrow="CARTEIRAS · AMBIENTE LOCAL" onClose={onClose}>
      <p className="modal-intro">
        Crie uma carteira para um jogador fictício. O saldo inicial gera um lançamento de abertura
        no extrato.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (guard.current) return;
          guard.current = true;
          setBusy(true);
          setError("");
          try {
            const initialBalance = { amount: normalizeAmount(amount), currency: selectedCurrency };
            const w = await request<Wallet>("/wallets", {
              method: "POST",
              body: JSON.stringify({ playerId: player, initialBalance }),
            });
            onCreated(w);
          } catch (err) {
            setError(
              `${errorText(err)}${err instanceof ApiError && err.uncertain ? " O resultado pode ter sido confirmado: consulte as carteiras por este ID de jogador antes de tentar novamente." : ""}`,
            );
          } finally {
            guard.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            ID do jogador
            <input
              required
              value={player}
              onChange={(e) => setPlayer(e.target.value)}
              pattern="[0-9a-fA-F-]{36}"
              placeholder="UUID do jogador fictício"
            />
            <span className="field-hint">Gerado localmente. Uma carteira por jogador e moeda.</span>
          </label>
          <div className="form-grid">
            <label>
              Saldo inicial
              <input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100,00"
              />
            </label>
            <label>
              Moeda
              <select
                value={selectedCurrency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
              >
                <option>BRL</option>
                <option>USD</option>
                <option>EUR</option>
              </select>
            </label>
          </div>
        </fieldset>
        {error && <ErrorBox message={error} />}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "Criando…" : "Criar carteira"}
            <Icon name="plus" size={18} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SubmitWager({
  currency,
  initialWallet,
  onClose,
  onChanged,
}: {
  currency: Currency;
  initialWallet?: Wallet;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(readDraft);
  const [walletId, setWalletId] = useState(initialWallet?.id ?? "");
  const [query, setQuery] = useState("");
  const [walletRevision, setWalletRevision] = useState(0);
  const wallets = useResource<Page<Wallet>>(
    `/dashboard/wallets?currency=${currency}&limit=100&query=${encodeURIComponent(query)}`,
    walletRevision,
  );
  const [kind, setKind] = useState<Kind>("BET");
  const [amount, setAmount] = useState("10,00");
  const [provider, setProvider] = useState("demo-provider");
  const [external, setExternal] = useState(() => crypto.randomUUID() as string);
  const [reference, setReference] = useState("");
  const [round, setRound] = useState("round-local");
  const [game, setGame] = useState("game-local");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [canReset, setCanReset] = useState(false);
  const [pollError, setPollError] = useState("");
  const guard = useRef(false);
  const refresh = useRef(onChanged);
  refresh.current = onChanged;
  useEffect(() => {
    setPollError("");
    if (!result?.status.startsWith("PENDING")) return;
    const transactionId = result.transactionId;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const tx = await request<Transaction>(`/wagering/transactions/${transactionId}`);
        if (active) {
          setPollError("");
          if (!tx.status.startsWith("PENDING")) {
            setResult({
              transactionId: tx.transactionId,
              status: tx.status,
              balance: tx.balance ?? null,
              failureCode: tx.failureCode,
              idempotentReplay: false,
            });
            setCanReset(true);
            refresh.current();
            return;
          }
        }
      } catch (err) {
        if (active)
          setPollError(
            `${errorText(err)} A pendência continua registrada. A consulta será repetida.`,
          );
      }
      // Schedule after completion so slow/offline requests never overlap.
      if (active) timer = setTimeout(() => void poll(), 2500);
    }
    timer = setTimeout(() => void poll(), 2500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [result?.transactionId, result?.status]);
  async function send() {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      let snapshot = draft;
      if (!snapshot) {
        const wallet =
          initialWallet?.id === walletId
            ? initialWallet
            : wallets.data?.items.find((w) => w.id === walletId);
        if (!wallet) throw new Error("Selecione uma carteira.");
        snapshot = {
          key: `web:${crypto.randomUUID()}`,
          body: {
            walletId: wallet.id,
            playerId: wallet.playerId,
            providerId: provider,
            externalTransactionId: external,
            roundId: round,
            gameId: game,
            kind,
            money: {
              amount: kind === "LOSS" ? "0.00" : normalizeAmount(amount),
              currency: wallet.balance.currency,
            },
            ...(reference ? { referenceExternalTransactionId: reference } : {}),
          },
        };
        saveDraft(snapshot);
        setDraft(snapshot);
      }
      const response = await submit(snapshot);
      setWalletRevision((value) => value + 1);
      setResult(response);
      // A pending response has a durable transaction ID: the user can now submit
      // its missing reference. Only an uncertain transport outcome locks the draft.
      setCanReset(true);
      onChanged();
    } catch (err) {
      setError(
        `${errorText(err)}${err instanceof ApiError && err.uncertain ? " Resultado não confirmado. A nova tentativa reutiliza exatamente a mesma operação e chave." : ""}`,
      );
      setCanReset(err instanceof ApiError && !err.uncertain);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={draft ? "Resultado da transação" : "Nova transação"}
      eyebrow="TRANSAÇÕES · SIMULAÇÃO"
      onClose={onClose}
      wide
    >
      {draft ? (
        <>
          <div className="receipt">
            <div>
              <span className="eyebrow">
                {kindNames[draft.body.kind]} · {draft.body.money.currency}
              </span>
              <strong>{money(draft.body.money)}</strong>
              <p>Carteira {short(draft.body.walletId)}</p>
            </div>
            <span className="clay-icon">
              <Icon name="shield" size={30} />
            </span>
          </div>
          <p className="notice">
            Operação preservada nesta aba. Reenviar usa os mesmos dados e a mesma chave, mesmo após
            recarregar a página.
          </p>
          <details className="technical">
            <summary>Identificadores da operação</summary>
            <div className="detail-field">
              Chave de idempotência
              <Copy value={draft.key} />
            </div>
            <div className="detail-field">
              ID externo
              <Copy value={draft.body.externalTransactionId} />
            </div>
            <div className="detail-field">
              Provedor<code>{draft.body.providerId}</code>
            </div>
          </details>
        </>
      ) : (
        <form
          id="wager-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <fieldset disabled={busy}>
            {!initialWallet && (
              <label>
                Buscar carteira
                <input
                  type="search"
                  placeholder="ID da carteira ou do jogador"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            )}
            <label>
              Carteira
              <select required value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                <option value="">Selecione uma carteira em {currency}</option>
                {initialWallet ? (
                  <option value={initialWallet.id}>
                    {short(initialWallet.id)} · {initialWallet.balance.currency}
                  </option>
                ) : (
                  wallets.data?.items.map((w) => (
                    <option key={w.id} value={w.id}>
                      {short(w.id)} · {money(w.balance)}
                    </option>
                  ))
                )}
              </select>
            </label>
            {wallets.error && !initialWallet && <ErrorBox message={wallets.error} />}
            {wallets.data?.nextCursor && (
              <small>Exibindo 100 carteiras. Busque pelo ID para refinar.</small>
            )}
            <div className="form-grid">
              <label>
                Operação
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as Kind);
                    setReference("");
                  }}
                >
                  {Object.entries(kindNames)
                    .filter(([key]) => key !== "OPENING")
                    .map(([key, label]) => (
                      <option key={key} value={key}>
                        {label} · {key}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Valor ({currency})
                <input
                  required
                  inputMode="decimal"
                  value={kind === "LOSS" ? "0,00" : amount}
                  disabled={kind === "LOSS"}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            </div>
            {!["BET", "LOSS"].includes(kind) && (
              <label>
                ID externo da referência {kind === "WIN" ? "(opcional)" : ""}
                <input
                  required={kind !== "WIN"}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={128}
                />
                <span className="field-hint">
                  Mesmo provedor e carteira. Reembolso e reversão usam o valor integral da
                  referência.
                </span>
              </label>
            )}
            <div className="form-grid">
              <label>
                Provedor
                <input
                  required
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  pattern="[A-Za-z0-9][A-Za-z0-9_.:\-]*"
                  maxLength={128}
                />
              </label>
              <label>
                ID externo
                <input
                  required
                  value={external}
                  onChange={(e) => setExternal(e.target.value)}
                  pattern="[A-Za-z0-9][A-Za-z0-9_.:\-]*"
                  maxLength={128}
                />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Jogo
                <input
                  required
                  value={game}
                  onChange={(e) => setGame(e.target.value)}
                  maxLength={128}
                />
              </label>
              <label>
                Rodada
                <input
                  required
                  value={round}
                  onChange={(e) => setRound(e.target.value)}
                  maxLength={128}
                />
              </label>
            </div>
          </fieldset>
          <p className="field-hint">
            A transação altera apenas o saldo simulado. A chave de idempotência é criada
            automaticamente.
          </p>
        </form>
      )}
      {result && (
        <div
          className={`result-box ${result.status === "PROCESSED" ? "success" : ""}`}
          aria-live="polite"
        >
          <Status status={result.status} />
          <p>
            {result.status === "PROCESSED"
              ? "Operação confirmada no banco."
              : result.status.startsWith("PENDING")
                ? "Aguardando a referência. Esta janela consulta o resultado periodicamente. Você pode iniciar outra operação e acompanhar esta pendência em Transações."
                : "Operação encerrada sem movimentação de saldo."}{" "}
            {result.idempotentReplay && "Replay: decisão original recuperada."}
          </p>
          {result.balance && (
            <p>
              Saldo após a decisão: <b>{money(result.balance)}</b>
            </p>
          )}
          {result.failureCode && <code>{result.failureCode}</code>}
          <Copy value={result.transactionId} />
        </div>
      )}
      {error && <ErrorBox message={error} />}
      {pollError && <ErrorBox message={pollError} />}
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          Fechar
        </button>
        {canReset && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              try {
                saveDraft(null);
                setDraft(null);
                setResult(null);
                setError("");
                setCanReset(false);
                setPollError("");
                setExternal(crypto.randomUUID());
              } catch (err) {
                setError(errorText(err));
              }
            }}
          >
            Nova operação
          </button>
        )}
        {draft ? (
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => void send()}
          >
            {busy ? "Enviando…" : result ? "Reenviar mesma operação" : "Enviar mesma operação"}
            <Icon name="refresh" size={17} />
          </button>
        ) : (
          <button className="button primary" type="submit" form="wager-form" disabled={busy}>
            {busy ? "Enviando…" : "Confirmar transação"}
            <Icon name="arrow" size={17} />
          </button>
        )}
      </div>
    </Modal>
  );
}

export function WalletDetail({
  id,
  revision,
  onClose,
  onWager,
}: {
  id: string;
  revision: number;
  onClose: () => void;
  onWager: (wallet: Wallet) => void;
}) {
  const wallet = useResource<Wallet>(`/wallets/${id}`, revision);
  const [cursor, setCursor] = useState("");
  const ledger = useResource<Page<Ledger>>(
    `/wallets/${id}/ledger?limit=8${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    revision,
  );
  const [reconciliation, setReconciliation] = useState<Reconciliation>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title="Detalhes da carteira" eyebrow="CARTEIRAS" onClose={onClose} wide>
      {wallet.loading && <Loading />}
      {wallet.error && <ErrorBox message={wallet.error} />}
      {wallet.data && (
        <>
          <div className="receipt">
            <div>
              <span className="eyebrow">SALDO DISPONÍVEL · {wallet.data.balance.currency}</span>
              <strong>{money(wallet.data.balance)}</strong>
              <p>Versão {wallet.data.version}</p>
            </div>
            <span className="clay-icon">
              <Icon name="wallet" size={30} />
            </span>
          </div>
          <div className="detail-ids">
            <div className="detail-field">
              Carteira
              <Copy value={wallet.data.id} />
            </div>
            <div className="detail-field">
              Jogador
              <Copy value={wallet.data.playerId} />
            </div>
          </div>
          <div className="inline-actions">
            <button type="button" className="button primary" onClick={() => onWager(wallet.data!)}>
              <Icon name="plus" size={17} />
              Nova transação
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                setReconciliation(undefined);
                try {
                  setReconciliation(
                    await request<Reconciliation>(`/wallets/${id}/reconciliation`, {
                      method: "POST",
                    }),
                  );
                } catch (err) {
                  setError(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="shield" size={17} />
              {busy ? "Conferindo…" : "Reconciliar saldo"}
            </button>
          </div>
        </>
      )}
      {error && <ErrorBox message={error} />}
      {reconciliation && (
        <div
          className={`result-box ${reconciliation.consistent ? "success" : ""}`}
          aria-live="polite"
        >
          <b>{reconciliation.consistent ? "Saldo consistente" : "Divergência encontrada"}</b>
          <p>
            {reconciliation.checkedEntries} lançamentos conferidos · Ledger{" "}
            {money(reconciliation.calculatedBalance)} · Diferença {money(reconciliation.difference)}
          </p>
          <small>Consulta de verificação. Nenhuma correção automática é aplicada.</small>
        </div>
      )}
      <div className="section-heading">
        <h3>Extrato da carteira</h3>
        {cursor && (
          <button type="button" className="text-button" onClick={() => setCursor("")}>
            Voltar ao início
          </button>
        )}
      </div>
      <p className="field-hint">Da abertura ao mais recente · horários de Brasília</p>
      {ledger.loading && <Loading />}
      {ledger.error && <ErrorBox message={ledger.error} />}
      {ledger.data &&
        (ledger.data.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lançamento</th>
                  <th>Valor</th>
                  <th>Saldo após</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.items.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className={`movement ${l.direction === "CREDIT" ? "credit" : "debit"}`}>
                        {l.direction === "CREDIT" ? "Entrada" : "Saída"}
                      </span>
                      <small>{short(l.transactionId)}</small>
                    </td>
                    <td>{money(l.money)}</td>
                    <td>{money(l.balanceAfter)}</td>
                    <td>{date(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Ainda sem lançamentos">A primeira movimentação aparecerá aqui.</Empty>
        ))}
      {ledger.data?.nextCursor && (
        <button
          type="button"
          className="button secondary next-page"
          onClick={() => setCursor(ledger.data!.nextCursor!)}
        >
          Próxima página
          <Icon name="chevron" size={16} />
        </button>
      )}
    </Modal>
  );
}
export function TransactionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [revision, setRevision] = useState(0);
  const {
    data: tx,
    error,
    loading,
  } = useResource<Transaction>(`/wagering/transactions/${id}`, revision);
  return (
    <Modal title="Detalhes da transação" eyebrow="TRILHA DA OPERAÇÃO" onClose={onClose} wide>
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      {tx && (
        <>
          <div className="receipt">
            <div>
              <span className="eyebrow">
                {kindNames[tx.kind]} · {tx.kind}
              </span>
              <strong>{money(tx.money)}</strong>
              <p>{date(tx.createdAt)} · Brasília</p>
            </div>
            <Status status={tx.status} />
          </div>
          {tx.failureCode && <ErrorBox message={tx.failureCode} />}
          <div className="detail-ids">
            <div className="detail-field">
              ID interno
              <Copy value={tx.transactionId} />
            </div>
            <div className="detail-field">
              ID externo
              <Copy value={tx.externalTransactionId} />
            </div>
            <div className="detail-field">
              Carteira
              <Copy value={tx.walletId} />
            </div>
            {tx.referenceExternalTransactionId && (
              <div className="detail-field">
                Referência externa
                <Copy value={tx.referenceExternalTransactionId} />
              </div>
            )}
            <div className="form-grid">
              <div className="detail-field">
                Provedor<strong>{tx.providerId}</strong>
              </div>
              <div className="detail-field">
                Saldo da decisão
                <strong>{tx.balance ? money(tx.balance) : "Aguardando decisão"}</strong>
              </div>
              <div className="detail-field">
                Jogo<strong>{tx.gameId ?? "—"}</strong>
              </div>
              <div className="detail-field">
                Rodada<strong>{tx.roundId ?? "—"}</strong>
              </div>
            </div>
          </div>
          <p className="notice">
            O saldo acima pertence à decisão original. Movimentações posteriores aparecem no saldo
            atual da carteira.
          </p>
        </>
      )}
      <div className="modal-actions">
        <button
          type="button"
          className="button secondary"
          onClick={() => setRevision((v) => v + 1)}
        >
          <Icon name="refresh" size={17} />
          Atualizar resultado
        </button>
      </div>
    </Modal>
  );
}

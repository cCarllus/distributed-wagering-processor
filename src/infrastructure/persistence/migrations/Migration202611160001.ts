import { Migration } from "@mikro-orm/migrations";
export class Migration202611160001 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
CREATE TABLE wallets (
 id uuid PRIMARY KEY, player_id uuid NOT NULL, currency varchar(3) NOT NULL CHECK(currency IN ('BRL','USD','EUR')),
 balance bigint NOT NULL CHECK(balance BETWEEN 0 AND 9999999999999999), version integer NOT NULL CHECK(version >= 1),
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, UNIQUE(player_id,currency)
);
CREATE TABLE wager_transactions (
 id uuid PRIMARY KEY, provider_id varchar(128) NOT NULL, external_id varchar(128) NOT NULL,
 wallet_id uuid NOT NULL, player_id uuid NOT NULL, currency varchar(3) NOT NULL CHECK(currency IN ('BRL','USD','EUR')),
 amount bigint NOT NULL CHECK(amount BETWEEN 0 AND 9999999999999999),
 kind text NOT NULL CHECK(kind IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
 status text NOT NULL CHECK(status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
 reference_id uuid REFERENCES wager_transactions(id), payload_hash text NOT NULL,
 input jsonb NOT NULL, idempotency_key text NOT NULL UNIQUE, failure_code text, result_balance bigint,
 result_currency varchar(3), created_at timestamptz NOT NULL, processed_at timestamptz,
 reference_attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL,
 correlation_id text NOT NULL, causation_id text,
 UNIQUE(provider_id,external_id), CHECK((kind='LOSS' AND amount=0) OR (kind<>'LOSS' AND amount>0)),
 CHECK(result_balance IS NULL OR result_balance BETWEEN 0 AND 9999999999999999),
 CHECK((status IN ('REJECTED','FAILED')) = (failure_code IS NOT NULL)),
 CHECK(status<>'PROCESSED' OR kind NOT IN ('REFUND','ROLLBACK') OR reference_id IS NOT NULL)
);
CREATE UNIQUE INDEX one_reversal_per_kind ON wager_transactions(reference_id,kind)
 WHERE kind IN ('REFUND','ROLLBACK') AND status='PROCESSED';
CREATE INDEX reference_due ON wager_transactions(next_attempt_at,id) WHERE status='PENDING_REFERENCE';
CREATE TABLE idempotency_keys (key text PRIMARY KEY, transaction_id uuid NOT NULL REFERENCES wager_transactions(id), payload_hash text NOT NULL);
CREATE TABLE wallet_ledger (
 id uuid PRIMARY KEY, sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE, wallet_id uuid NOT NULL REFERENCES wallets(id),
 transaction_id uuid NOT NULL REFERENCES wager_transactions(id), direction text NOT NULL CHECK(direction IN ('CREDIT','DEBIT')),
 amount bigint NOT NULL CHECK(amount>0), currency varchar(3) NOT NULL,
 balance_before bigint NOT NULL CHECK(balance_before>=0), balance_after bigint NOT NULL CHECK(balance_after>=0), created_at timestamptz NOT NULL,
 UNIQUE(wallet_id,transaction_id), CHECK(balance_after=balance_before+CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END)
);
CREATE INDEX ledger_cursor ON wallet_ledger(wallet_id,sequence);
CREATE TABLE inbox (
 consumer_name text NOT NULL, message_id text NOT NULL, payload_hash text NOT NULL,
 received_at timestamptz NOT NULL, processed_at timestamptz, transaction_id uuid REFERENCES wager_transactions(id), PRIMARY KEY(consumer_name,message_id)
);
CREATE TABLE outbox (
 id uuid PRIMARY KEY, aggregate_id uuid NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL,
 occurred_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL,
 published_at timestamptz, lease_token uuid, lease_until timestamptz
);
CREATE INDEX outbox_due ON outbox(next_attempt_at,occurred_at,id) WHERE published_at IS NULL;
CREATE FUNCTION ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LEDGER_APPEND_ONLY' USING ERRCODE='23514'; END $$;
CREATE TRIGGER ledger_no_mutation BEFORE UPDATE OR DELETE ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER ledger_no_truncate BEFORE TRUNCATE ON wallet_ledger FOR EACH STATEMENT EXECUTE FUNCTION ledger_immutable();
CREATE FUNCTION terminal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status IN ('PROCESSED','REJECTED','FAILED') THEN RAISE EXCEPTION 'TERMINAL_TRANSACTION_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER transaction_terminal BEFORE UPDATE OR DELETE ON wager_transactions FOR EACH ROW EXECUTE FUNCTION terminal_immutable();
CREATE FUNCTION wallet_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wid uuid; bal bigint; ver integer; total numeric; movements bigint; broken boolean;
BEGIN
 IF TG_TABLE_NAME='wallets' THEN wid:=NEW.id; ELSE wid:=NEW.wallet_id; END IF;
 SELECT balance,version INTO bal,ver FROM wallets WHERE id=wid;
 SELECT COALESCE(SUM(CASE l.direction WHEN 'CREDIT' THEN l.amount ELSE -l.amount END),0),
 COUNT(*) FILTER (WHERE t.kind<>'OPENING') INTO total,movements
 FROM wallet_ledger l JOIN wager_transactions t ON t.id=l.transaction_id WHERE l.wallet_id=wid;
 IF bal<>total OR ver<>1+movements THEN RAISE EXCEPTION 'WALLET_LEDGER_DIVERGENCE' USING ERRCODE='23514'; END IF;
 SELECT EXISTS(SELECT 1 FROM (SELECT balance_before, lag(balance_after,1,0::bigint) OVER(ORDER BY sequence) prior FROM wallet_ledger WHERE wallet_id=wid) chain WHERE balance_before<>prior) INTO broken;
 IF broken THEN RAISE EXCEPTION 'LEDGER_CHAIN_BROKEN' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER wallet_balanced AFTER INSERT OR UPDATE ON wallets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet_consistency();
CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON wallet_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallet_consistency();
CREATE FUNCTION transaction_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tx wager_transactions; n bigint;
BEGIN
 IF TG_TABLE_NAME='wallet_ledger' THEN SELECT * INTO tx FROM wager_transactions WHERE id=NEW.transaction_id;
 ELSE SELECT * INTO tx FROM wager_transactions WHERE id=NEW.id; END IF;
 SELECT count(*) INTO n FROM wallet_ledger WHERE transaction_id=tx.id;
 IF (tx.status='PROCESSED' AND tx.kind<>'LOSS' AND n<>1) OR ((tx.status<>'PROCESSED' OR tx.kind='LOSS') AND n<>0) THEN RAISE EXCEPTION 'TRANSACTION_LEDGER_MISMATCH' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM wallet_ledger l JOIN wallets w ON w.id=l.wallet_id WHERE l.transaction_id=tx.id AND (l.amount<>tx.amount OR l.currency<>tx.currency OR w.currency<>tx.currency OR w.player_id<>tx.player_id OR l.wallet_id<>tx.wallet_id OR l.balance_after<>tx.result_balance OR l.direction <> CASE WHEN tx.kind='BET' OR (tx.kind='ROLLBACK' AND (SELECT kind FROM wager_transactions WHERE id=tx.reference_id) IN ('WIN','REFUND')) THEN 'DEBIT' ELSE 'CREDIT' END)) THEN RAISE EXCEPTION 'LEDGER_TRANSACTION_FIELDS_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER transaction_balanced AFTER INSERT OR UPDATE ON wager_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION transaction_consistency();
CREATE CONSTRAINT TRIGGER ledger_transaction_balanced AFTER INSERT ON wallet_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION transaction_consistency();
`);
  }
  async down(): Promise<void> {
    this.addSql(`DROP TABLE outbox, inbox, idempotency_keys, wallet_ledger, wager_transactions, wallets CASCADE;
DROP FUNCTION transaction_consistency(), wallet_consistency(), terminal_immutable(), ledger_immutable();`);
  }
}

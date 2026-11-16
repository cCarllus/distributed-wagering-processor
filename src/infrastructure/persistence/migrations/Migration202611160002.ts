import { Migration } from "@mikro-orm/migrations";
export class Migration202611160002 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      "CREATE INDEX reference_due_by_wallet ON wager_transactions(wallet_id,next_attempt_at,id) WHERE status='PENDING_REFERENCE'",
    );
  }
  async down(): Promise<void> {
    this.addSql("DROP INDEX reference_due_by_wallet");
  }
}

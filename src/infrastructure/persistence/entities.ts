import { EntitySchema } from "@mikro-orm/core";
export class WalletRecord {
  id!: string;
  playerId!: string;
  currency!: string;
  balance!: string;
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}
export const WalletSchema = new EntitySchema<WalletRecord>({
  class: WalletRecord,
  tableName: "wallets",
  properties: {
    id: { type: "uuid", primary: true },
    playerId: { type: "uuid", fieldName: "player_id" },
    currency: { type: "string", length: 3 },
    balance: { type: "string", columnType: "bigint" },
    version: { type: "integer" },
    createdAt: { type: "Date", fieldName: "created_at", columnType: "timestamptz" },
    updatedAt: { type: "Date", fieldName: "updated_at", columnType: "timestamptz" },
  },
});

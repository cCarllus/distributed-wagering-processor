import "reflect-metadata";
import { Migrator } from "@mikro-orm/migrations";
import { MikroORM } from "@mikro-orm/postgresql";
import { config } from "../../config";
import { Telemetry } from "../observability/telemetry";
import { WalletSchema } from "./entities";
import { Migration202611160001 } from "./migrations/Migration202611160001";
import { Migration202611160002 } from "./migrations/Migration202611160002";
export async function connect() {
  const telemetry = new Telemetry();
  return MikroORM.init({
    clientUrl: config().databaseUrl,
    entities: [WalletSchema],
    extensions: [Migrator],
    migrations: {
      migrationsList: [
        { name: "Migration202611160001", class: Migration202611160001 },
        { name: "Migration202611160002", class: Migration202611160002 },
      ],
      transactional: true,
      allOrNothing: true,
      snapshot: false,
    },
    pool: { min: 0, max: 12 },
    driverOptions: {
      connection: { connectionTimeoutMillis: 3000, statement_timeout: 5000, query_timeout: 6000 },
      acquireConnectionTimeout: 6000,
      log: {
        warn: () => telemetry.log("database_connection_warning", { code: "DATABASE_UNAVAILABLE" }),
        error: () => telemetry.log("database_driver_error", { code: "DATABASE_UNAVAILABLE" }),
      },
    },
    debug: false,
  });
}

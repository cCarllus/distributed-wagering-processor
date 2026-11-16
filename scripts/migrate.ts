import { connect } from "../src/infrastructure/persistence/orm";

const orm = await connect();
try {
  const direction = process.argv[2];
  if (direction === "up") await orm.migrator.up();
  else if (direction === "down") await orm.migrator.down();
  else throw new Error("Expected up or down");
  console.log(`Migration ${direction}: OK`);
} finally {
  await orm.close(true);
}

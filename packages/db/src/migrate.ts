import { closeDb, getDb, isPglite, MIGRATIONS_DIR } from "./client";

/**
 * `npm run db:migrate`: applies migrations to DATABASE_URL (PGlite migrates itself on open).
 * DATABASE_URL_UNPOOLED (Neon's direct connection) wins when set: migrations should not go
 * through the connection pooler.
 */
async function main() {
  if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
  const db = await getDb();
  if (!isPglite()) {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  }
  console.log(`Migrations applied (${isPglite() ? "PGlite" : "PostgreSQL"}).`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

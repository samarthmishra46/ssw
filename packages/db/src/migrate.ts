import { closeDb, getDb, isPglite, MIGRATIONS_DIR } from "./client";

/** `npm run db:migrate`: applies migrations to DATABASE_URL (PGlite migrates itself on open). */
async function main() {
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

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? path.resolve(here, "../drizzle");

type State = { db: Promise<Db>; close: () => Promise<void> };

const g = globalThis as unknown as { __sswDb?: State };

/**
 * DATABASE_URL=postgres://...       -> PostgreSQL (Vercel / RDS)
 * DATABASE_URL unset or pglite:<dir> -> PGlite: in-process Postgres for local dev and tests
 *                                      ("pglite:memory" for a throwaway database). Migrated automatically.
 */
export function getDb(): Promise<Db> {
  if (!g.__sswDb) g.__sswDb = open();
  return g.__sswDb.db;
}

export async function closeDb(): Promise<void> {
  const s = g.__sswDb;
  g.__sswDb = undefined;
  if (s) await s.close();
}

export function isPglite(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return !(url.startsWith("postgres://") || url.startsWith("postgresql://"));
}

function open(): State {
  const url = process.env.DATABASE_URL ?? "";

  if (!isPglite()) {
    const client = postgres(url, {
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      prepare: !url.includes("pgbouncer=true"),
      onnotice: () => {},
    });
    return { db: Promise.resolve(drizzlePg(client, { schema })), close: () => client.end() };
  }

  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PGLITE !== "1") {
    throw new Error("DATABASE_URL must be a postgres:// URL in production");
  }

  let closer: () => Promise<void> = async () => {};
  const db = (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const dir = url.startsWith("pglite:") ? url.slice("pglite:".length) : process.env.PGLITE_DIR;
    let client;
    if (dir === "memory") client = new PGlite();
    else {
      const dataDir = dir || path.resolve(process.cwd(), ".data/pglite");
      mkdirSync(dataDir, { recursive: true }); // PGlite only creates the last folder, not its parents
      client = new PGlite(dataDir);
    }
    const pg = drizzle(client, { schema });
    await migrate(pg, { migrationsFolder: MIGRATIONS_DIR });
    closer = () => client.close();
    return pg as unknown as Db;
  })();
  return { db, close: () => closer() };
}

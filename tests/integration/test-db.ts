import path from "node:path";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { PG_CONNECTION_OPTIONS } from "@/lib/db";

/**
 * Integration tests against a real PostgreSQL (constitution V; CLAUDE.md:
 * «lo que toca la base se prueba contra PostgreSQL real»).
 *
 * `TEST_DATABASE_URL` points at a server where the tests may create
 * databases (locally, the docker-compose.dev.yml one on 5433). Each test file
 * gets its own fresh, migrated database and drops it at the end. Without the
 * variable the integration tests are skipped, so `pnpm test` still runs
 * anywhere.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Creates the database and points the app at it. Call it in `beforeAll`,
 * before the first `getDb()`: the app reads `DATABASE_URL` once per process
 * (and Vitest gives each test file its own).
 */
export async function useTestDatabase(): Promise<{ drop: () => Promise<void> }> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required for integration tests");
  const name = `vocero_test_${randomBytes(5).toString("hex")}`;
  const admin = postgres(TEST_DATABASE_URL, { max: 1, ...PG_CONNECTION_OPTIONS });
  await admin.unsafe(`create database "${name}"`);
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;

  Object.assign(process.env, {
    DATABASE_URL: url.toString(),
    APP_BASE_URL: process.env.APP_BASE_URL ?? "http://localhost:3000",
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "integration-test-secret",
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64"),
    META_WEBHOOK_VERIFY_TOKEN: process.env.META_WEBHOOK_VERIFY_TOKEN ?? "integration-verify",
  });

  const migrator = postgres(url.toString(), { max: 1, ...PG_CONNECTION_OPTIONS });
  await migrate(drizzle(migrator), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await migrator.end();

  return {
    drop: async () => {
      const { getSql } = await import("@/lib/db");
      await getSql().end({ timeout: 1 }).catch(() => {});
      await admin.unsafe(`drop database if exists "${name}" with (force)`);
      await admin.end();
    },
  };
}

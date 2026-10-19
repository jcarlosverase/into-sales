import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_CONNECTION_OPTIONS } from "@/lib/db";
import { TEST_DATABASE_URL, useTestDatabase } from "./test-db";

/** 1002 — Las fechas en `timestamptz` y la base en hora de Lima. */
describe.skipIf(!TEST_DATABASE_URL)("1002 — timestamptz and Lima database time zone", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ drop } = await useTestDatabase());
  });

  afterAll(async () => {
    await drop?.();
  });

  /** Una sesión cualquiera, como la de psql: sin fijar zona. */
  const plainSession = () => postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

  it("every date column is timestamptz (AC1)", async () => {
    const { getSql } = await import("@/lib/db");
    const rows = await getSql()`
      select data_type, count(*)::int as n from information_schema.columns
      where table_schema = 'public' and data_type like 'timestamp%' group by data_type`;
    expect(rows).toEqual([{ data_type: "timestamp with time zone", n: 83 }]);
  });

  it("a new session defaults to America/Lima (AC2)", async () => {
    const s = plainSession();
    try {
      const [row] = await s`show timezone`;
      expect(row?.TimeZone).toBe("America/Lima");
    } finally {
      await s.end();
    }
  });

  it("now() and JS writes store the same instant, shown at -05 in Lima (AC3)", async () => {
    const { getDb, schema } = await import("@/lib/db");
    const db = getDb();
    const before = Date.now();
    await db.insert(schema.organization).values({ id: "org_tz_default", name: "Por defecto" });
    const at = new Date("2026-10-15T14:00:00Z");
    await db.insert(schema.organization).values({ id: "org_tz_js", name: "Desde JS", createdAt: at });

    const [byDefault] = await db.select().from(schema.organization).where(sql`id = 'org_tz_default'`);
    expect(Math.abs(byDefault!.createdAt.getTime() - before)).toBeLessThan(60_000);
    const [fromJs] = await db.select().from(schema.organization).where(sql`id = 'org_tz_js'`);
    expect(fromJs!.createdAt.toISOString()).toBe("2026-10-15T14:00:00.000Z");

    const s = plainSession();
    try {
      const [row] = await s`select created_at::text as t from organization where id = 'org_tz_js'`;
      expect(row?.t).toBe("2026-10-15 09:00:00-05");
    } finally {
      await s.end();
    }
  });

  it("Resultados groups by the business day, not by the session (AC4)", async () => {
    const { getDb, schema } = await import("@/lib/db");
    const { localDateExpr } = await import("@/server/analytics/shared");
    const db = getDb();
    // 22:00 del 15 en Lima, ya 16 en UTC.
    await db.insert(schema.organization).values({ id: "org_tz_night", name: "Noche", createdAt: new Date("2026-10-16T03:00:00Z") });
    const [row] = await db
      .select({ day: localDateExpr(schema.organization.createdAt, "America/Lima", false) })
      .from(schema.organization)
      .where(sql`id = 'org_tz_night'`);
    expect(row?.day).toBe("2026-10-15");
  });
});

/** AC1 y AC5 — la migración sobre una base que ya tenía datos en el esquema viejo. */
describe.skipIf(!TEST_DATABASE_URL)("1002 — migrating a database with data", () => {
  const name = `into_sales_test_${randomBytes(5).toString("hex")}`;
  let admin: ReturnType<typeof postgres>;
  let url: string;
  let previous: string;

  beforeAll(async () => {
    admin = postgres(TEST_DATABASE_URL!, { max: 1, ...PG_CONNECTION_OPTIONS });
    await admin.unsafe(`create database "${name}"`);
    const u = new URL(TEST_DATABASE_URL!);
    u.pathname = `/${name}`;
    url = u.toString();
    // Las migraciones de antes de la 1002: la misma carpeta sin la última entrada.
    previous = mkdtempSync(path.join(tmpdir(), "drizzle-1001-"));
    cpSync(path.join(process.cwd(), "drizzle"), previous, { recursive: true });
    const journalPath = path.join(previous, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
    expect(journal.entries.at(-1)?.tag).toBe("0024_timestamptz_lima");
    journal.entries.pop();
    writeFileSync(journalPath, JSON.stringify(journal));
  });

  afterAll(async () => {
    rmSync(previous, { recursive: true, force: true });
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.end();
  });

  it("keeps every instant and does nothing the second time", async () => {
    const conn = postgres(url, { max: 1, ...PG_CONNECTION_OPTIONS });
    try {
      await migrate(drizzle(conn), { migrationsFolder: previous });
      // En el esquema viejo, «14:00» sin zona significaba 14:00 UTC.
      await conn`insert into organization (id, name, created_at) values ('org_old', 'Vieja', '2026-10-15 14:00:00')`;
      const folder = path.join(process.cwd(), "drizzle");
      await migrate(drizzle(conn), { migrationsFolder: folder });
      await migrate(drizzle(conn), { migrationsFolder: folder });
      const [row] = await conn`select created_at from organization where id = 'org_old'`;
      expect(new Date(row!.created_at as string | Date).toISOString()).toBe("2026-10-15T14:00:00.000Z");
    } finally {
      await conn.end();
    }
  });
});

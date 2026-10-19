import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Todo lo que toca la base recibe su sonda por parámetro; aquí no hay
// Postgres ni drizzle. Se mockea la capa de BD para que el módulo cargue sin
// ella (como en credentials.test.ts) y la prueba siga siendo unitaria.
vi.mock("@/lib/db", () => ({ getDb: vi.fn(), schema: {}, PG_CONNECTION_OPTIONS: {} }));
vi.mock("@/lib/db/tenant", () => ({ scoped: vi.fn() }));

import {
  checkDatabase,
  checkMediaDir,
  checkWhatsApp,
  describeDbError,
  evaluateComposeEnv,
  evaluateEnv,
  formatResult,
  requiredEnvKeys,
  summarize,
  type CheckResult,
} from "@/server/doctor/checks";
import { renderInitEnv } from "@/server/doctor/init-env";
import type { Credentials } from "@/server/whatsapp/credentials";

/**
 * `pnpm doctor` usa el MISMO esquema que el arranque (safeParseEnv) y, para
 * cada ✗, dice el comando exacto. Y jamás imprime un secreto: aquí se busca
 * cada valor secreto en la salida formateada, no solo en los campos.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const EXAMPLE = readFileSync(path.join(ROOT, ".env.example"), "utf8");

const VALID = {
  APP_BASE_URL: "https://localhost",
  DATABASE_URL: "postgresql://postgres:pw-secreta-xyz@postgres:5432/into_sales",
  BETTER_AUTH_SECRET: "secreto-de-sesiones-" + "s".repeat(24),
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "token-verificacion-" + "t".repeat(45),
};

const byLabel = (results: CheckResult[], label: string) =>
  results.find((r) => r.label === label);

const output = (results: CheckResult[]) => results.map(formatResult).join("\n");

describe("requiredEnvKeys", () => {
  it("son las del esquema sin default ni optional, sin copiarlas a mano", () => {
    expect(requiredEnvKeys()).toEqual([
      "APP_BASE_URL",
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "ENCRYPTION_KEY",
      "META_WEBHOOK_VERIFY_TOKEN",
    ]);
  });
});

describe("evaluateEnv", () => {
  it("un entorno válido: una ✓ por obligatoria y el env parseado", () => {
    const { results, env } = evaluateEnv(VALID);
    expect(results.map((r) => r.status)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(env?.APP_BASE_URL).toBe("https://localhost");
  });

  it("lo que deja pnpm init-env pasa entero", () => {
    const { results, env } = evaluateEnv(parseEnv(renderInitEnv(EXAMPLE).content));
    expect(results.every((r) => r.status === "ok")).toBe(true);
    expect(env).not.toBeNull();
  });

  it("el .env.example copiado tal cual: cada placeholder sale ✗ con su comando", () => {
    const { results, env } = evaluateEnv(parseEnv(EXAMPLE));
    expect(env).toBeNull();
    for (const key of requiredEnvKeys()) {
      const r = byLabel(results, key);
      expect(r?.status, key).toBe("fail");
      expect(r?.detail, key).toContain("REEMPLAZA_");
    }
    expect(byLabel(results, "BETTER_AUTH_SECRET")?.fix).toContain("openssl rand -base64 32");
    expect(byLabel(results, "ENCRYPTION_KEY")?.fix).toContain("openssl rand -base64 32");
    expect(byLabel(results, "META_WEBHOOK_VERIFY_TOKEN")?.fix).toContain("openssl rand -hex 32");
    expect(byLabel(results, "APP_BASE_URL")?.fix).toContain("https://");
    // Las de compose las lista evaluateComposeEnv: aquí no se duplican.
    expect(byLabel(results, "DOMAIN")).toBeUndefined();
    expect(byLabel(results, "POSTGRES_PASSWORD")).toBeUndefined();
  });

  it("una variable que falta y una ENCRYPTION_KEY mal generada: mensaje en español y el arreglo", () => {
    const source: Record<string, string> = { ...VALID, ENCRYPTION_KEY: "corta" };
    delete source.META_WEBHOOK_VERIFY_TOKEN;
    const { results } = evaluateEnv(source);
    const token = byLabel(results, "META_WEBHOOK_VERIFY_TOKEN");
    expect(token?.status).toBe("fail");
    expect(token?.detail).toBe("falta");
    expect(token?.fix).toContain("openssl rand -hex 32");
    const key = byLabel(results, "ENCRYPTION_KEY");
    expect(key?.status).toBe("fail");
    expect(key?.detail).toContain("32 bytes");
  });

  it("una URL mal escrita y un secreto corto se explican sin inglés", () => {
    const { results } = evaluateEnv({
      ...VALID,
      APP_BASE_URL: "crm.ejemplo.com",
      BETTER_AUTH_SECRET: "corto",
    });
    expect(byLabel(results, "APP_BASE_URL")?.detail).toContain("no es una URL válida");
    expect(byLabel(results, "BETTER_AUTH_SECRET")?.detail).toContain("mínimo 16");
  });

  it("una opcional mal escrita también sale ✗: tumba el arranque igual", () => {
    const { results, env } = evaluateEnv({ ...VALID, OPENROUTER_BASE_URL: "no-es-url" });
    expect(env).toBeNull();
    expect(byLabel(results, "OPENROUTER_BASE_URL")?.status).toBe("fail");
  });

  it("jamás imprime un secreto: ni en ✓ ni en ✗", () => {
    const text = output(evaluateEnv(VALID).results);
    expect(text).not.toContain("pw-secreta-xyz");
    expect(text).not.toContain(VALID.BETTER_AUTH_SECRET);
    expect(text).not.toContain(VALID.ENCRYPTION_KEY);
    expect(text).not.toContain(VALID.META_WEBHOOK_VERIFY_TOKEN);
    expect(text).toContain("postgresql://postgres:***@postgres:5432/into_sales");
    expect(text).toContain("definida (44 caracteres)");

    const broken = output(
      evaluateEnv({ ...VALID, ENCRYPTION_KEY: "clave-rota-no-base64-zzz" }).results
    );
    expect(broken).not.toContain("clave-rota-no-base64-zzz");
  });
});

describe("evaluateComposeEnv (DOMAIN y POSTGRES_PASSWORD)", () => {
  it("placeholder: ✗ con su arreglo; ausente: solo informativo", () => {
    const withPlaceholder = evaluateComposeEnv(parseEnv(EXAMPLE));
    expect(byLabel(withPlaceholder, "DOMAIN")?.status).toBe("fail");
    expect(byLabel(withPlaceholder, "POSTGRES_PASSWORD")?.status).toBe("fail");
    expect(byLabel(withPlaceholder, "POSTGRES_PASSWORD")?.fix).toContain("openssl rand -hex 24");

    const missing = evaluateComposeEnv(VALID);
    expect(missing.map((r) => r.status)).toEqual(["skip", "skip"]);
  });

  it("avisa cuando POSTGRES_PASSWORD no es la contraseña de DATABASE_URL (host postgres)", () => {
    const results = evaluateComposeEnv({ ...VALID, DOMAIN: "localhost", POSTGRES_PASSWORD: "otra" });
    const notice = results.find((r) => r.status === "warn");
    expect(notice?.label).toBe("POSTGRES_PASSWORD");
    expect(notice?.fix).toContain("docker compose");
    expect(output(results)).not.toContain("pw-secreta-xyz");
  });

  it("no avisa cuando coinciden", () => {
    const results = evaluateComposeEnv({ ...VALID, DOMAIN: "localhost", POSTGRES_PASSWORD: "pw-secreta-xyz" });
    expect(results.every((r) => r.status === "ok")).toBe(true);
  });
});

describe("checkDatabase", () => {
  const url = VALID.DATABASE_URL;

  it("select 1 responde: ✓ con la URL sin contraseña", async () => {
    const r = await checkDatabase(url, async () => {});
    expect(r.status).toBe("ok");
    expect(r.detail).toContain("postgres:***@");
    expect(formatResult(r)).not.toContain("pw-secreta-xyz");
  });

  it("ECONNREFUSED: nada escucha, y cómo arrancar Postgres", async () => {
    const r = await checkDatabase(url, async () => {
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    });
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("nada escucha");
    expect(r.fix).toContain("docker compose");
  });

  it("el host «postgres» sin resolver no es un fallo: es la red interna de compose", () => {
    const r = describeDbError(Object.assign(new Error("getaddrinfo ENOTFOUND postgres"), { code: "ENOTFOUND" }), url);
    expect(r.status).toBe("skip");
    expect(r.fix).toContain("docker compose up -d");
  });

  it("otro host sin resolver sí es ✗", () => {
    const r = describeDbError(
      Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }),
      "postgresql://postgres:x@bd.interna:5432/into_sales"
    );
    expect(r.status).toBe("fail");
  });

  it("28P01: contraseña rechazada, y dónde se corrige", () => {
    const r = describeDbError(Object.assign(new Error("password authentication failed"), { code: "28P01" }), url);
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("contraseña");
    expect(r.fix).toContain("POSTGRES_PASSWORD");
    expect(formatResult(r)).not.toContain("pw-secreta-xyz");
  });
});

describe("checkMediaDir", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "vocero-doctor-media-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("directorio escribible (lo crea si falta): ✓", async () => {
    const r = await checkMediaDir(path.join(tmp, "media"));
    expect(r.status).toBe("ok");
  });

  it("no escribible: ✗ con qué hacer dentro y fuera de Docker", async () => {
    const file = path.join(tmp, "no-soy-directorio");
    await writeFile(file, "x");
    const r = await checkMediaDir(path.join(file, "media"));
    expect(r.status).toBe("fail");
    expect(r.fix).toContain("/data");
  });
});

describe("checkWhatsApp", () => {
  const credentials = (token: string): Credentials => ({
    id: "cred_1",
    organizationId: "org_1",
    wabaId: "waba1",
    phoneNumberId: "pn1",
    displayPhoneNumber: "+52 1 55 0000 0000",
    verifiedName: "Ferretería",
    status: "connected",
    token,
  });
  const saved = (token: string) => ({
    organization: "Ferretería El Martillo",
    phoneNumberId: "pn1",
    displayPhoneNumber: "+52 1 55 0000 0000",
    credentials: credentials(token),
  });

  it("sin conexión guardada: informativo, no ✗ (se conecta desde la app)", async () => {
    const [r] = await checkWhatsApp({ load: async () => [] });
    expect(r?.status).toBe("skip");
    expect(r?.detail).toContain("Configuración → WhatsApp");
  });

  it("token vigente: ✓ con los últimos 4 del token y nunca el token entero", async () => {
    const token = "EAAG-token-super-secreto-abcd";
    const [r] = await checkWhatsApp({
      load: async () => [saved(token)],
      test: async () => ({ ok: true, displayPhoneNumber: "+52 55 0000 0000", verifiedName: "Ferretería" }),
    });
    expect(r?.status).toBe("ok");
    expect(r?.detail).toContain("…abcd");
    expect(formatResult(r!)).not.toContain("EAAG-token");
  });

  it("token vencido: ✗ y el arreglo es pegar uno nuevo en la app", async () => {
    const [r] = await checkWhatsApp({
      load: async () => [saved("EAAG-vencido-9999")],
      test: async () => ({ ok: false, code: "invalid_token", message: "El token no es válido o expiró." }),
    });
    expect(r?.status).toBe("fail");
    expect(r?.fix).toContain("Configuración → WhatsApp");
    expect(formatResult(r!)).not.toContain("EAAG-vencido");
  });

  it("Meta caída: aviso, no ✗ (no es algo que el usuario arregle)", async () => {
    const [r] = await checkWhatsApp({
      load: async () => [saved("EAAG-x-1234")],
      test: async () => ({ ok: false, code: "meta_unavailable", message: "Meta no está disponible" }),
    });
    expect(r?.status).toBe("warn");
  });

  it("una fila que no descifra apunta a la ENCRYPTION_KEY", async () => {
    const [r] = await checkWhatsApp({
      load: async () => [{ ...saved("x"), credentials: null }],
    });
    expect(r?.status).toBe("fail");
    expect(r?.detail).toContain("ENCRYPTION_KEY");
  });

  it("tablas sin migrar (42P01): informativo, con el paso que las crea", async () => {
    const [r] = await checkWhatsApp({
      load: async () => {
        throw Object.assign(new Error('relation "organization" does not exist'), { code: "42P01" });
      },
    });
    expect(r?.status).toBe("skip");
    expect(r?.fix).toContain("docker compose up -d");
  });
});

describe("formatResult y summarize", () => {
  it("✓ en una línea; ✗ con la flecha del arreglo debajo", () => {
    expect(formatResult({ status: "ok", label: "X", detail: "bien" })).toBe("✓ X — bien");
    expect(formatResult({ status: "fail", label: "X", detail: "mal", fix: "haz esto" })).toBe(
      "✗ X — mal\n    → haz esto"
    );
  });

  it("sale con 1 solo si hay ✗: los avisos y lo informativo no cuentan", () => {
    const ok: CheckResult = { status: "ok", label: "a" };
    const warn: CheckResult = { status: "warn", label: "b" };
    const skip: CheckResult = { status: "skip", label: "c" };
    const fail: CheckResult = { status: "fail", label: "d" };
    expect(summarize([ok, warn, skip]).exitCode).toBe(0);
    expect(summarize([ok, warn, skip, fail])).toMatchObject({ ok: 1, warn: 1, skip: 1, fail: 1, exitCode: 1 });
  });
});

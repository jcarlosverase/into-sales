import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #82 — `/api/health` dice qué banderas están encendidas y si el volumen de
 * adjuntos se puede escribir. Es lo que una plataforma o un script pueden
 * confirmar con un `curl`, sin iniciar sesión: que `AGENDA=on` llegó al
 * contenedor, que `/data` quedó bien montado. Y la imagen deja de llevar lo
 * que el migrador nunca abre.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

const { getEnv, getDb } = vi.hoisted(() => ({
  getEnv: vi.fn(),
  getDb: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getEnv }));
vi.mock("@/lib/db", () => ({ getDb, schema: {} }));

import { checkHealth, healthFeatures } from "@/server/health";
import {
  MEDIA_DIR_PROBE_TTL_MS,
  mediaDirStatus,
  resetMediaDirCache,
} from "@/server/media-dir";
import { GET } from "@/app/api/health/route";

const ENV_ORIGINAL = { ...process.env };
let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "vocero-health-"));
  resetMediaDirCache();
  getDb.mockReturnValue({ execute: async () => [] });
  getEnv.mockReturnValue({ MEDIA_DIR: path.join(tmp, "media") });
});

afterEach(async () => {
  process.env = { ...ENV_ORIGINAL };
  await rm(tmp, { recursive: true, force: true });
});

describe("features: las banderas de despliegue", () => {
  it("sin banderas: solo WhatsApp, agenda, atribución y central apagados", () => {
    expect(healthFeatures({})).toEqual({
      agenda: false,
      channels: ["whatsapp"],
      atribucion: false,
      central: false,
    });
  });

  it("con todas encendidas, los canales van en el orden del catálogo", () => {
    // El de la variable no: dos instancias iguales tienen que responder igual.
    expect(
      healthFeatures({
        AGENDA: "on",
        CHANNELS: "messenger, Instagram",
        ATRIBUCION: "1",
        INTO_CENTRAL_URL: "https://api.into.center",
      })
    ).toEqual({
      agenda: true,
      channels: ["whatsapp", "instagram", "messenger"],
      atribucion: true,
      central: true,
    });
  });

  it("un typo no enciende nada: dice lo que la app hace, no lo que se escribió", () => {
    // Mismos parsers que usan las rutas para responder 404: si aquí dijera
    // `true` y la agenda respondiera 404, el health mentiría.
    expect(
      healthFeatures({ AGENDA: "onn", CHANNELS: "telegram", ATRIBUCION: "off", INTO_CENTRAL_URL: "api.into.center" })
    ).toEqual({ agenda: false, channels: ["whatsapp"], atribucion: false, central: false });
  });
});

describe("mediaWritable: el volumen de adjuntos", () => {
  it("escribible → true, y el sondeo no deja rastro", async () => {
    const r = await checkHealth();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, mediaWritable: true });
    expect(await readdir(path.join(tmp, "media"))).toEqual([]);
  });

  it("no escribible → false, pero `ok` sigue en true y el código en 200", async () => {
    // Un healthcheck en rojo reiniciaría en bucle un contenedor que atiende
    // clientes: sin adjuntos el CRM funciona, y esto solo lo hace visible.
    const file = path.join(tmp, "no-soy-directorio");
    await writeFile(file, "x");
    getEnv.mockReturnValue({ MEDIA_DIR: path.join(file, "media") });

    const r = await checkHealth();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, mediaWritable: false });
  });

  it("no escribe en cada llamada: el sondeo se recuerda un minuto", async () => {
    const dir = path.join(tmp, "media");
    const t0 = 1_000_000;
    expect((await mediaDirStatus(t0))?.writable).toBe(true);

    // El directorio desaparece y en su lugar hay un archivo: un sondeo nuevo
    // diría false. Dentro del minuto se responde lo recordado; después, no.
    await rm(dir, { recursive: true, force: true });
    await writeFile(dir, "x");
    expect((await mediaDirStatus(t0 + MEDIA_DIR_PROBE_TTL_MS - 1))?.writable).toBe(true);
    expect((await mediaDirStatus(t0 + MEDIA_DIR_PROBE_TTL_MS))?.writable).toBe(false);
  });

  it("si MEDIA_DIR cambia, se sondea el nuevo aunque el anterior esté fresco", async () => {
    const t0 = 1_000_000;
    expect((await mediaDirStatus(t0))?.writable).toBe(true);

    const file = path.join(tmp, "no-soy-directorio");
    await writeFile(file, "x");
    getEnv.mockReturnValue({ MEDIA_DIR: path.join(file, "media") });
    expect((await mediaDirStatus(t0 + 1))?.writable).toBe(false);
  });

  it("sin entorno válido no hay directorio que sondear", async () => {
    getEnv.mockImplementation(() => {
      throw new Error("Variables de entorno inválidas");
    });
    expect(await mediaDirStatus()).toBeNull();
  });
});

describe("GET /api/health", () => {
  it("200 con la forma completa: lo de siempre más features y mediaWritable", async () => {
    process.env.AGENDA = "on";
    process.env.CHANNELS = "instagram";
    delete process.env.ATRIBUCION;

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      features: { agenda: true, channels: ["whatsapp", "instagram"], atribucion: false },
      mediaWritable: true,
    });
    expect(typeof body.version).toBe("string");
    // Los campos de antes siguen delante: quien ya lee `ok` y `version` no
    // nota el cambio.
    expect(Object.keys(body).slice(0, 2)).toEqual(["ok", "version"]);
  });

  it("BD caída: 503 y la misma respuesta de antes, sin features", async () => {
    getDb.mockReturnValue({
      execute: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: "db_unavailable", message: "Base de datos no disponible" },
    });
  });
});

describe("la imagen no lleva lo que el migrador no lee", () => {
  it("el migrador de drizzle-orm abre meta/_journal.json y los .sql, nada más", () => {
    // Si una versión nueva de drizzle-orm empezara a leer los snapshots en
    // runtime, el .dockerignore de abajo rompería las migraciones del
    // arranque: esto lo atrapa antes.
    const migrator = readFileSync(
      path.join(ROOT, "node_modules", "drizzle-orm", "migrator.js"),
      "utf8"
    );
    expect(migrator).toContain("meta/_journal.json");
    expect(migrator).toContain(".sql");
    expect(migrator).not.toMatch(/snapshot/i);
  });

  it("scripts/migrate.mjs tampoco los toca", () => {
    const script = readFileSync(path.join(ROOT, "scripts", "migrate.mjs"), "utf8");
    expect(script).toContain("drizzle-orm/postgres-js/migrator");
    expect(script).not.toMatch(/snapshot/i);
  });

  it(".dockerignore deja fuera meta/ salvo el journal, y los .sql se quedan", () => {
    const lines = readFileSync(path.join(ROOT, ".dockerignore"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    const excludes = lines.indexOf("drizzle/meta/*");
    const keeps = lines.indexOf("!drizzle/meta/_journal.json");
    expect(excludes).toBeGreaterThanOrEqual(0);
    // La excepción tiene que venir DESPUÉS: en .dockerignore manda la última
    // regla que coincide.
    expect(keeps).toBeGreaterThan(excludes);
    expect(lines.some((l) => /^drizzle\/?\*?$/.test(l) || l.endsWith(".sql"))).toBe(false);
  });
});

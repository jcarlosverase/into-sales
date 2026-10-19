import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { envSchema } from "@/lib/env";

/**
 * #88 — Un manifest por plataforma (Render, Fly, Railway) para desplegar la
 * imagen publicada fuera de Coolify con un comando. Cada uno declara lo que
 * su plataforma le deja declarar (puerto 3000, healthcheck /api/health,
 * volumen en /data, imagen fijada a la versión) y documenta, en comentarios,
 * lo que queda a mano. Las variables obligatorias salen del mismo esquema
 * que valida el arranque (src/lib/env.ts): si alguien agrega una nueva,
 * esto se pone rojo hasta que los tres manifests la lleven, declarada o en
 * el comando que la fija.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const pkg = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8")
) as { version: string };
const IMAGE = `ghcr.io/jcarlosverase/into-sales:${pkg.version}`;

// Un checkout de Windows con autocrlf deja CRLF: se normaliza para que las
// expresiones con `\n` lean lo mismo en cualquier máquina.
const read = (name: string) =>
  readFileSync(path.join(ROOT, name), "utf8").replace(/\r\n?/g, "\n");
/** Solo lo que la plataforma lee: sin las líneas de comentario. */
const withoutComments = (text: string) =>
  text
    .split("\n")
    .filter((linea) => !/^\s*#/.test(linea))
    .join("\n");

// Obligatoria = sin `.optional()` ni `.default()`. `isOptional()` solo prueba
// `undefined` contra el tipo: no lee el entorno ni deja nada cacheado.
const REQUIRED = Object.entries(envSchema.shape)
  .filter(([, kind]) => !kind.isOptional())
  .map(([key]) => key);

const render = read("render.yaml");
const fly = read("fly.toml");
const railway = read("railway.toml");

/** El bloque YAML de una variable de render.yaml: desde su `- key:` hasta el siguiente. */
function blockRender(key: string): string {
  const m = render.match(
    new RegExp(`^\\s*- key: ${key}\\n((?:(?!\\s*- key:).*\\n)*)`, "m")
  );
  expect(m, `render.yaml declara ${key}`).not.toBeNull();
  return m?.[1] ?? "";
}

describe("las variables obligatorias salen del esquema real", () => {
  it("son las cinco sin default", () => {
    expect(REQUIRED).toEqual(
      expect.arrayContaining([
        "APP_BASE_URL",
        "DATABASE_URL",
        "BETTER_AUTH_SECRET",
        "ENCRYPTION_KEY",
        "META_WEBHOOK_VERIFY_TOKEN",
      ])
    );
    expect(REQUIRED).not.toContain("META_GRAPH_API_VERSION");
    expect(REQUIRED).not.toContain("MEDIA_DIR");
  });
});

describe.each([
  ["render.yaml", render],
  ["fly.toml", fly],
  ["railway.toml", railway],
])("%s: lo común a los tres", (_name, text) => {
  it("nombra cada variable obligatoria, declarada o en el comando que la fija", () => {
    for (const key of REQUIRED) {
      expect(text, key).toMatch(new RegExp(`\\b${key}\\b`));
    }
  });

  it("fija la imagen publicada a la versión de package.json", () => {
    // Como el compose (tests/unit/version.test.ts): una etiqueta vieja en un
    // manifest instala la versión anterior mientras el CHANGELOG habla de
    // la nueva.
    expect(text).toContain(IMAGE);
    expect(text).not.toMatch(/into-sales:latest/);
  });

  it("apunta al healthcheck, al volumen de /data y al puerto de la imagen", () => {
    expect(text).toContain("/api/health");
    expect(text).toContain("/data");
    expect(text).toMatch(/\b3000\b/);
  });

  it("no define MEDIA_DIR: la imagen ya trae /data/media dentro del volumen", () => {
    // Definirla en la plataforma es exactamente cómo se mandan los adjuntos
    // fuera del volumen (INSTALL-AI.md, «Diagnóstico rápido»).
    expect(withoutComments(text)).not.toMatch(/MEDIA_DIR\s*[=:]/);
  });

  it("genera cada secreto con el comando que pide .env.example", () => {
    // ENCRYPTION_KEY son 32 bytes en base64; el verify token va en la URL del
    // webhook, así que es hex (sin `/`). O lo genera la plataforma con ese
    // mismo formato, o el comando documentado lo hace.
    expect(text).toMatch(/ENCRYPTION_KEY[\s\S]{0,200}(openssl rand -base64 32|generateValue: true)/);
    expect(text).toMatch(/META_WEBHOOK_VERIFY_TOKEN[\s\S]{0,300}openssl rand -hex 32/);
  });
});

describe("render.yaml: el Blueprint declara todo lo que Render deja declarar", () => {
  const isActive = withoutComments(render);

  it("servicio web desde la imagen, con healthcheck y disco en /data", () => {
    expect(isActive).toMatch(/^\s*runtime: image$/m);
    expect(isActive).toMatch(new RegExp(`^\\s*url: ${IMAGE.replace(/[.]/g, "\\.")}$`, "m"));
    expect(isActive).toMatch(/^\s*healthCheckPath: \/api\/health$/m);
    expect(isActive).toMatch(/^\s*mountPath: \/data$/m);
  });

  it("fija PORT=3000: Render mete PORT=10000 por defecto y la imagen escucha en 3000", () => {
    expect(blockRender("PORT")).toMatch(/value: "3000"/);
  });

  it("cada variable obligatoria es una entrada real de envVars", () => {
    for (const key of REQUIRED) {
      expect(isActive, key).toMatch(new RegExp(`^\\s*- key: ${key}$`, "m"));
    }
  });

  it("DATABASE_URL viene de la base del Blueprint y APP_BASE_URL de la URL del servicio", () => {
    expect(blockRender("DATABASE_URL")).toMatch(/fromDatabase:[\s\S]*name: into-sales-db[\s\S]*property: connectionString/);
    expect(isActive).toMatch(/^databases:\n\s*- name: into-sales-db$/m);
    expect(blockRender("APP_BASE_URL")).toMatch(/fromService:[\s\S]*envVarKey: RENDER_EXTERNAL_URL/);
  });

  it("los secretos los genera Render (256 bits base64 = los 32 bytes de ENCRYPTION_KEY)", () => {
    expect(blockRender("BETTER_AUTH_SECRET")).toMatch(/generateValue: true/);
    expect(blockRender("ENCRYPTION_KEY")).toMatch(/generateValue: true/);
  });

  it("el verify token NO se genera: en base64 llevaría `/` y es un segmento de la URL del webhook", () => {
    const block = blockRender("META_WEBHOOK_VERIFY_TOKEN");
    expect(block).toMatch(/sync: false/);
    expect(withoutComments(block)).not.toMatch(/generateValue/);
  });

  it("la base no queda abierta a cualquier IP", () => {
    expect(isActive).toMatch(/^\s*ipAllowList: \[\]$/m);
  });
});

describe("fly.toml: lo que cabe en el archivo y los comandos de lo que no", () => {
  const isActive = withoutComments(fly);

  it("imagen publicada, volumen en /data, puerto 3000 y healthcheck", () => {
    expect(isActive).toMatch(new RegExp(`^\\s*image = "${IMAGE.replace(/[.]/g, "\\.")}"$`, "m"));
    expect(isActive).toMatch(/^\s*destination = "\/data"$/m);
    expect(isActive).toMatch(/^\s*internal_port = 3000$/m);
    expect(isActive).toMatch(/^\s*path = "\/api\/health"$/m);
  });

  it("APP_BASE_URL va en [env] y coincide con el nombre de la app", () => {
    const app = isActive.match(/^app = "([^"]+)"$/m)?.[1];
    expect(app).toBeTruthy();
    expect(isActive).toMatch(new RegExp(`^\\s*APP_BASE_URL = "https://${app}\\.fly\\.dev"$`, "m"));
  });

  it("la máquina no se apaga sola: el agente, el Laboratorio y el SSE corren dentro del proceso", () => {
    expect(isActive).toMatch(/^\s*auto_stop_machines = "off"$/m);
  });

  it("los secretos van por `fly secrets set` y DATABASE_URL por `attach`", () => {
    for (const key of ["BETTER_AUTH_SECRET", "ENCRYPTION_KEY", "META_WEBHOOK_VERIFY_TOKEN"]) {
      expect(fly).toMatch(new RegExp(`fly secrets set[\\s\\S]{0,300}${key}=`));
      // Y no en [env], que es visible en el fly.toml del repo.
      expect(isActive, key).not.toMatch(new RegExp(`^\\s*${key} =`, "m"));
    }
    expect(fly).toMatch(/fly postgres attach into-sales-db --app into-sales/);
    expect(fly).toMatch(/fly volumes create sales_data --app into-sales/);
  });
});

describe("railway.toml: solo build, healthcheck y reinicio; el resto, con la CLI", () => {
  const isActive = withoutComments(railway);

  it("construye desde el Dockerfile con healthcheck y reinicio ante fallos", () => {
    expect(isActive).toMatch(/^\s*builder = "DOCKERFILE"$/m);
    expect(isActive).toMatch(/^\s*healthcheckPath = "\/api\/health"$/m);
    expect(isActive).toMatch(/^\s*restartPolicyType = "ON_FAILURE"$/m);
  });

  it("documenta la base, el volumen en /data, el dominio al puerto 3000 y cada variable", () => {
    expect(railway).toMatch(/railway add --database postgres/);
    expect(railway).toMatch(/railway volume add --mount-path \/data/);
    expect(railway).toMatch(/railway domain --port 3000/);
    for (const key of REQUIRED) {
      expect(railway, key).toMatch(new RegExp(`railway variable set[\\s\\S]{0,600}${key}=`));
    }
    expect(railway).toMatch(/DATABASE_URL=\$\{\{Postgres\.DATABASE_URL\}\}/);
    expect(railway).toMatch(/APP_BASE_URL=https:\/\/\$\{\{RAILWAY_PUBLIC_DOMAIN\}\}/);
  });
});

describe("la documentación lleva a los manifests", () => {
  it("el README tiene la sección y enlaza los tres; INSTALL-AI.md apunta a ella", () => {
    const readme = read("README.md");
    expect(readme).toMatch(/^### Otras plataformas/m);
    for (const file of ["render.yaml", "fly.toml", "railway.toml"]) {
      expect(readme).toContain(`](${file})`);
    }
    expect(read("INSTALL-AI.md")).toMatch(/Otras plataformas/);
  });
});

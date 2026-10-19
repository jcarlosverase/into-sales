import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Spec 1001: el instalador valida todo antes de tocar el sistema. Estas
// pruebas solo corren la validación (nunca llegan a Docker ni a /opt).
const SCRIPT = "deploy/install.sh";
const run = (...args: string[]) => spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });

describe("deploy/install.sh (spec 1001)", () => {
  it("--help explica el uso y sale bien", () => {
    const r = run("--help");
    expect(r.status).toBe(0);
    for (const option of ["--client", "--domain", "--central", "--no-central", "--env", "--update", "--uninstall"]) {
      expect(r.stdout).toContain(option);
    }
  });

  it.each([
    [[], "falta --domain"],
    [["--domain", "no es dominio"], "dominio inválido"],
    [["--domain", "crm.cliente.com;rm"], "dominio inválido"],
    [["--domain", "crm.cliente.com", "--client", "Cliente Uno"], "cliente inválido"],
    [["--domain", "crm.cliente.com", "--central", "api.into.center"], "URL del central inválida"],
    [["--domain", "crm.cliente.com", "--central"], "--central necesita la URL"],
    [["--domain", "crm.cliente.com", "--ports", "80"], "puertos inválidos"],
    [["--domain", "crm.cliente.com", "--source", "/no/existe"], "no existe la carpeta"],
    [["--domain", "crm.cliente.com", "--env", "agenda=on"], "--env espera CLAVE=valor"],
    [["--domain", "crm.cliente.com", "--env", "AGENDA"], "--env espera CLAVE=valor"],
    [["--domain", "crm.cliente.com", "--env", "ENCRYPTION_KEY=x"], "la maneja el instalador"],
    [["--domain", "crm.cliente.com", "--env", "INTO_CENTRAL_URL=x"], "usa --central"],
    [["--update", "--client", "no-instalado", "--base", "/no/existe"], "no está instalado"],
    [["--uninstall", "--client", "no-instalado", "--base", "/no/existe"], "no está instalado"],
    [["--dominio", "crm.cliente.com"], "opción desconocida"],
    [["--quien-sabe"], "opción desconocida"],
  ])("rechaza %j antes de tocar nada", (args, message) => {
    const r = run(...args);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(message);
  });

  it("la capa del VPS apaga el Caddy propio y conecta la app a la red compartida", () => {
    const vps = readFileSync("deploy/docker-compose.vps.yml", "utf8");
    expect(vps).toMatch(/caddy:\s*\n\s*profiles:/);
    expect(vps).toContain("name: into_edge");
    expect(vps).toContain("${EDGE_ALIAS");
  });

  it("el compose le pasa INTO_CENTRAL_URL a la app (sin ella el latido no se enciende)", () => {
    expect(readFileSync("docker-compose.yml", "utf8")).toContain("INTO_CENTRAL_URL: ${INTO_CENTRAL_URL:-}");
  });

  it("la base se llama into_sales, sin rastro de vocero", () => {
    const compose = readFileSync("docker-compose.yml", "utf8");
    expect(compose).toContain("POSTGRES_DB: into_sales");
    expect(compose).toContain("@postgres:5432/into_sales");
    expect(compose).not.toMatch(/5432\/vocero|POSTGRES_DB: vocero/);
  });

  // Spec 1006.
  it("logs each site without the webhook token, with a request id, and closes /api/metrics", () => {
    for (const file of ["Caddyfile", "deploy/install.sh"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).toContain("request>uri regexp");
      expect(text, file).toContain("[redacted]");
      expect(text, file).toContain("request_header X-Request-Id {http.request.uuid}");
      expect(text, file).toContain("respond /api/metrics 404");
    }
  });

  it("rotates the container logs and passes the metrics token to the app", () => {
    const compose = readFileSync("docker-compose.yml", "utf8");
    expect(compose.match(/logging: \*logging/g)).toHaveLength(3);
    expect(compose).toContain("METRICS_TOKEN: ${METRICS_TOKEN:-}");
  });
});

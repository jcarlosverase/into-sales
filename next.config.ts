import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// La versión sale de package.json y no de una constante aparte: duplicarla es
// tenerla desactualizada en uno de los dos lados, y justo esta no puede mentir.
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

/**
 * Public host of this instance when it is not localhost (for example a
 * Cloudflare tunnel in local development, see docs/cloudflare-tunnel.md).
 * `next dev` only serves its dev assets to allowed origins; without this the
 * app opened through the tunnel loads its HTML but not its scripts.
 */
function devPublicHost(): string[] {
  try {
    const host = new URL(process.env.APP_BASE_URL ?? "").hostname;
    return host && host !== "localhost" ? [host] : [];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  // En desarrollo también la red local: abrir el CRM desde el celular o desde
  // otra máquina (http://192.168.1.94:3000). Solo afecta a `next dev`.
  allowedDevOrigins: [...devPublicHost(), "192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],
  // standalone es para la imagen Docker (Linux). En Windows el trazado crea
  // symlinks que requieren permisos elevados, así que ahí se omite.
  output: process.platform === "win32" ? undefined : "standalone",
  // El paquete `postgres` usa APIs de Node que no deben empaquetarse en el bundle.
  serverExternalPackages: ["postgres"],
  // Se congelan al construir: lo que queda aquí va dentro del binario y no
  // cambia en tiempo de ejecución. El commit solo se congela si `SOURCE_COMMIT`
  // llega AL BUILD (build arg `SOURCE_COMMIT`; con docker compose,
  // `--build-arg`). Si no llega, esto queda vacío y el servidor cae al
  // `SOURCE_COMMIT` del entorno al arrancar, marcado como NO verificado
  // (`src/lib/version.ts`, #50): puede no ser el del código que corre.
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_BUILD_COMMIT: process.env.SOURCE_COMMIT ?? "",
  },
  // El código y sus carpetas van en inglés: la ficha del lead vive en
  // /api/bot/qualification. La URL de siempre sigue respondiendo porque es
  // parte del contrato con los cerebros externos (README, «Trae tu propio agente»).
  async rewrites() {
    return [{ source: "/api/bot/ficha", destination: "/api/bot/qualification" }];
  },
};

export default nextConfig;

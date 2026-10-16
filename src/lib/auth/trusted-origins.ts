/**
 * Orígenes en los que Better Auth confía además de APP_BASE_URL.
 *
 * - `TRUSTED_ORIGINS` (opcional, separados por coma): dominios extra, también
 *   en producción.
 * - Solo fuera de producción: el origen de la petición si es localhost o una IP
 *   de red privada (192.168.x.x, 10.x.x.x, 172.16–31.x.x). Así se puede abrir el
 *   CRM de desarrollo desde el celular o desde otra máquina de la misma red
 *   (`http://192.168.1.94:3000`) sin que el login falle con «Invalid origin».
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host.endsWith(".local")) return true;
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function toOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function trustedOrigins(
  request: Request | undefined,
  env: { NODE_ENV?: string; TRUSTED_ORIGINS?: string }
): string[] {
  const extra = (env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map(toOrigin)
    .filter((o): o is string => o !== null);
  if (env.NODE_ENV === "production" || !request) return extra;
  const origin = toOrigin(request.headers.get("origin") ?? "");
  if (origin && isPrivateHost(new URL(origin).hostname)) extra.push(origin);
  return extra;
}

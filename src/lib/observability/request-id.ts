/**
 * Request IDs (spec 009). The shared Caddy sets `X-Request-Id` on every
 * request it proxies and writes the same value in its access log; the
 * middleware keeps it, or mints one when the request arrived without Caddy
 * (local development, the container healthcheck). Edge-safe: no Node APIs.
 */
export const REQUEST_ID_HEADER = "x-request-id";

const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** The incoming ID when it looks like one; a fresh UUID otherwise. */
export function resolveRequestId(incoming: string | null | undefined, mint: () => string = () => crypto.randomUUID()): string {
  return incoming && SAFE_ID.test(incoming) ? incoming : mint();
}

/** The ID the middleware left on the request, or null outside a request. */
export function requestIdOf(headers: Headers): string | null {
  const value = headers.get(REQUEST_ID_HEADER);
  return value && SAFE_ID.test(value) ? value : null;
}

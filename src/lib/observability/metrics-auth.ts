import { createHash, timingSafeEqual } from "node:crypto";

/**
 * GET /api/metrics answers only to `Authorization: Bearer <METRICS_TOKEN>`
 * (spec 009). Without a token configured, or with a wrong one, the route
 * does not exist: 404, same as any unknown path.
 */
export function isMetricsAuthorized(header: string | null, token: string | undefined): boolean {
  if (!token) return false;
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!match?.[1]) return false;
  // Hashing first gives both sides the same length for timingSafeEqual.
  const given = createHash("sha256").update(match[1]).digest();
  const expected = createHash("sha256").update(token).digest();
  return timingSafeEqual(given, expected);
}

import { getEnv } from "@/lib/env";
import { metrics } from "@/lib/observability/metrics";
import { isMetricsAuthorized } from "@/lib/observability/metrics-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/metrics: Prometheus format for the monitoring stack (spec 009).
 * Only with the bearer token; Caddy also refuses it on the public domains.
 */
export async function GET(req: Request) {
  if (!isMetricsAuthorized(req.headers.get("authorization"), getEnv().METRICS_TOKEN)) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(await metrics.registry.metrics(), {
    headers: { "content-type": metrics.registry.contentType, "cache-control": "no-store" },
  });
}

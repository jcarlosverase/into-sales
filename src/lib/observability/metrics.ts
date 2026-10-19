import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

/**
 * Prometheus metrics of the CRM (spec 1006), served by GET /api/metrics.
 * Process metrics (memory, CPU, event loop) plus a few counters of the main
 * flows. Only counts and durations: never a phone, a name or a message.
 */
export type SalesMetrics = ReturnType<typeof createMetrics>;

export function createMetrics(options: { defaults?: boolean } = {}) {
  const registry = new Registry();
  if (options.defaults ?? true) collectDefaultMetrics({ register: registry });

  const metrics = {
    registry,
    buildInfo: new Gauge({
      name: "into_sales_build_info",
      help: "Always 1; the version of the running build is in the label.",
      labelNames: ["version"] as const,
      registers: [registry],
    }),
    webhooks: new Counter({
      name: "into_sales_webhook_requests_total",
      help: "Webhook POSTs from Meta and TikTok, by channel and result.",
      labelNames: ["channel", "result"] as const,
      registers: [registry],
    }),
    agentTurns: new Counter({
      name: "into_sales_agent_turns_total",
      help: "Turns of the AI agent, by result.",
      labelNames: ["result"] as const,
      registers: [registry],
    }),
    agentTurnSeconds: new Histogram({
      name: "into_sales_agent_turn_seconds",
      help: "How long a turn of the AI agent takes, model calls included.",
      buckets: [0.5, 1, 2, 5, 10, 20, 40, 80],
      registers: [registry],
    }),
    centralHeartbeats: new Counter({
      name: "into_sales_central_heartbeats_total",
      help: "Heartbeats sent to the into central service, by result.",
      labelNames: ["result"] as const,
      registers: [registry],
    }),
    requestErrors: new Counter({
      name: "into_sales_request_errors_total",
      help: "Uncaught errors while rendering a page or running a route, by kind of route.",
      labelNames: ["route_type"] as const,
      registers: [registry],
    }),
  };
  metrics.buildInfo.set({ version: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown" }, 1);
  return metrics;
}

// In globalThis: in dev Next evaluates modules more than once, and a second
// registry would register every metric twice.
const globalForMetrics = globalThis as unknown as { __intoSalesMetrics?: SalesMetrics };

export const metrics: SalesMetrics = (globalForMetrics.__intoSalesMetrics ??= createMetrics());

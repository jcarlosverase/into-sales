import { metrics } from "@/lib/observability/metrics";

/** The result label of a webhook response, from its HTTP status (spec 1006). */
export function webhookResult(status: number): string {
  if (status >= 200 && status < 300) return "accepted";
  if (status === 404) return "invalid_token";
  if (status === 401) return "invalid_signature";
  return `http_${status}`;
}

/**
 * Wraps a webhook POST handler so each delivery is counted by channel and
 * result. The handler, its checks and its answer stay exactly as they were.
 */
export function countWebhook<Rest extends unknown[]>(
  channel: string,
  handler: (req: Request, ...rest: Rest) => Promise<Response>,
): (req: Request, ...rest: Rest) => Promise<Response> {
  return async (req, ...rest) => {
    const response = await handler(req, ...rest);
    metrics.webhooks.inc({ channel, result: webhookResult(response.status) });
    return response;
  };
}

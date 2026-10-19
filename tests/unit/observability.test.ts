import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, resolveLevel, routeConsoleToLogger } from "@/lib/observability/logger";
import { createMetrics } from "@/lib/observability/metrics";
import { safePath } from "@/lib/observability/safe-path";
import { countWebhook, webhookResult } from "@/lib/observability/webhooks";
import { isMetricsAuthorized } from "@/lib/observability/metrics-auth";
import { requestIdOf, resolveRequestId } from "@/lib/observability/request-id";

/** A logger that writes into an array of parsed JSON lines. */
function capture(level: "info" | "debug" = "info") {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split("\n").filter(Boolean)) lines.push(JSON.parse(line));
      done();
    },
  });
  return { lines, logger: createLogger({ level, destination }) };
}

describe("logger", () => {
  it("writes one JSON line with the level as a word, the service and an ISO time", () => {
    const { lines, logger } = capture();
    logger.info({ requestId: "abc12345" }, "Heartbeat");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "info", service: "into-sales", requestId: "abc12345", msg: "Heartbeat" });
    expect(String(lines[0]!.time)).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("never writes secrets under the usual keys, at the top or one level down", () => {
    const { lines, logger } = capture();
    logger.info({ token: "123:abc", headers: { authorization: "Bearer k", cookie: "s=1" }, user: { password: "p" } }, "x");
    const text = JSON.stringify(lines[0]);
    for (const secret of ["123:abc", "Bearer k", "s=1", '"p"']) expect(text).not.toContain(secret);
    expect(lines[0]).toMatchObject({ token: "[redacted]", headers: { authorization: "[redacted]" } });
  });

  it("serializes errors with message and stack", () => {
    const { lines, logger } = capture();
    logger.error({ err: new Error("boom") }, "Request failed");
    expect(lines[0]).toMatchObject({ level: "error", err: { type: "Error", message: "boom" } });
    expect(String((lines[0]!.err as { stack: string }).stack)).toContain("boom");
  });

  it("takes LOG_LEVEL when valid, silent under Vitest and info otherwise", () => {
    expect(resolveLevel({ LOG_LEVEL: "DEBUG" })).toBe("debug");
    expect(resolveLevel({ LOG_LEVEL: "loud" })).toBe("info");
    expect(resolveLevel({ VITEST: "true" })).toBe("silent");
    expect(resolveLevel({})).toBe("info");
  });

  it("routes console calls through the logger, with the first error in err", () => {
    const { lines, logger } = capture("debug");
    const sink = {} as Pick<Console, "log" | "info" | "warn" | "error" | "debug">;
    routeConsoleToLogger(logger, sink);
    sink.log("[boot] %d runs", 2);
    sink.error("[webhook] error processing payload:", new Error("bad json"));
    expect(lines[0]).toMatchObject({ level: "info", msg: "[boot] 2 runs" });
    expect(lines[1]).toMatchObject({ level: "error", msg: "[webhook] error processing payload", err: { message: "bad json" } });
  });
});

describe("request id", () => {
  it("keeps a well-formed incoming id and mints one otherwise", () => {
    const uuid = "0b9c4c1e-3f7a-4f0e-9b8e-2f5d6a7b8c9d";
    expect(resolveRequestId(uuid)).toBe(uuid);
    expect(resolveRequestId(null, () => "minted-1")).toBe("minted-1");
    expect(resolveRequestId("short", () => "minted-2")).toBe("minted-2");
    expect(resolveRequestId("bad id\nwith newline", () => "minted-3")).toBe("minted-3");
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reads the id the middleware left on the request", () => {
    expect(requestIdOf(new Headers({ "x-request-id": "abcdef123456" }))).toBe("abcdef123456");
    expect(requestIdOf(new Headers())).toBeNull();
  });
});

describe("metrics", () => {
  it("answers only to the right bearer token, and never without one configured", () => {
    const token = "m".repeat(40);
    expect(isMetricsAuthorized(`Bearer ${token}`, token)).toBe(true);
    expect(isMetricsAuthorized(`bearer ${token}`, token)).toBe(true);
    expect(isMetricsAuthorized("Bearer wrong", token)).toBe(false);
    expect(isMetricsAuthorized(null, token)).toBe(false);
    expect(isMetricsAuthorized(`Bearer ${token}`, undefined)).toBe(false);
  });

  it("labels webhook deliveries by response status and counts them per channel", async () => {
    expect([200, 404, 401, 500].map(webhookResult)).toEqual(["accepted", "invalid_token", "invalid_signature", "http_500"]);
    const handler = countWebhook("whatsapp", async () => new Response(null, { status: 401 }));
    const response = await handler(new Request("http://crm.test/api/webhooks/wa/x", { method: "POST" }));
    expect(response.status).toBe(401);
  });

  it("exposes the agent, webhook and central counters", async () => {
    const metrics = createMetrics({ defaults: false });
    metrics.webhooks.inc({ channel: "whatsapp", result: "accepted" });
    metrics.agentTurns.inc({ result: "ok" });
    metrics.agentTurnSeconds.observe(3);
    metrics.centralHeartbeats.inc({ result: "ok" });
    const text = await metrics.registry.metrics();
    expect(text).toContain('into_sales_webhook_requests_total{channel="whatsapp",result="accepted"} 1');
    expect(text).toContain('into_sales_agent_turns_total{result="ok"} 1');
    expect(text).toContain('into_sales_agent_turn_seconds_bucket{le="5"} 1');
    expect(text).toContain('into_sales_central_heartbeats_total{result="ok"} 1');
    expect(text).toContain("into_sales_build_info");
  });
});

describe("safe paths for logs", () => {
  it("drops the query string and hides the webhook token", () => {
    expect(safePath("/api/webhooks/wa/s3cr3tT0ken?hub.verify_token=abc")).toBe("/api/webhooks/wa/[redacted]");
    expect(safePath("/api/webhooks/ig/s3cr3tT0ken")).toBe("/api/webhooks/ig/[redacted]");
    expect(safePath("/reset-password?token=xyz")).toBe("/reset-password");
    expect(safePath("/inbox")).toBe("/inbox");
  });
});

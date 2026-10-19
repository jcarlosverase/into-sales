import { format } from "node:util";
import pino, { type Logger } from "pino";

/**
 * Structured JSON logs on stdout (spec 009). Docker keeps them and Loki reads
 * them on the VPS; one line per event, with `level` as a word so it can be
 * filtered without a lookup table.
 *
 * Secrets never reach a log line (constitution, I): the keys below are
 * replaced wherever they appear, one level deep, as a safety net. The rule
 * is still not to pass them in the first place.
 */
export const REDACTED_KEYS = [
  "authorization",
  "cookie",
  "password",
  "token",
  "apiKey",
  "api_key",
  "secret",
  "pepper",
] as const;

const LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LEVELS)[number];

/** `LOG_LEVEL` when valid; `silent` under Vitest; `info` otherwise. */
export function resolveLevel(source: Record<string, string | undefined> = process.env): LogLevel {
  const wanted = source.LOG_LEVEL?.trim().toLowerCase();
  if (wanted && (LEVELS as readonly string[]).includes(wanted)) return wanted as LogLevel;
  return source.VITEST ? "silent" : "info";
}

export function createLogger(options: { level?: LogLevel; destination?: pino.DestinationStream } = {}): Logger {
  const paths = REDACTED_KEYS.flatMap((key) => [key, `*.${key}`]);
  return pino(
    {
      level: options.level ?? resolveLevel(),
      base: { service: "into-sales", version: process.env.NEXT_PUBLIC_APP_VERSION },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths, censor: "[redacted]" },
    },
    options.destination,
  );
}

// In globalThis: in dev Next evaluates modules more than once.
const globalForLogger = globalThis as unknown as { __intoSalesLogger?: Logger };

export const logger: Logger = (globalForLogger.__intoSalesLogger ??= createLogger());

const CONSOLE_LEVELS = { log: "info", info: "info", warn: "warn", error: "error", debug: "debug" } as const;

/**
 * Sends `console.*` through the logger, so what Next and the libraries print
 * also comes out as JSON. The first Error among the arguments goes to `err`
 * (message and stack); the rest is formatted like console does.
 */
export function routeConsoleToLogger(target: Logger = logger, sink: Pick<Console, keyof typeof CONSOLE_LEVELS> = console): void {
  for (const [method, level] of Object.entries(CONSOLE_LEVELS) as [keyof typeof CONSOLE_LEVELS, LogLevel][]) {
    sink[method] = (...args: unknown[]) => {
      const err = args.find((arg) => arg instanceof Error);
      const msg = format(...args.filter((arg) => arg !== err)).replace(/:\s*$/, "");
      if (err) target[level as "info"]({ err }, msg);
      else target[level as "info"](msg);
    };
  }
}

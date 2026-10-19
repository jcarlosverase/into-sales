/**
 * A request path fit for a log line (spec 1006): without the query string,
 * which may carry a reset token or Meta's verify token, and with the secret
 * segment of the webhook URLs (/api/webhooks/<channel>/<token>) hidden.
 */
export function safePath(path: string): string {
  return path.split("?")[0]!.replace(/^(\/api\/webhooks\/[^/]+\/)[^/]+/, "$1[redacted]");
}

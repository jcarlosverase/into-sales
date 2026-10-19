import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";

/**
 * Spec 1006: every request carries an `X-Request-Id` (Caddy's, or a new one)
 * to the handlers and back in the response, so a log line can be matched
 * with the request that caused it. Nothing else happens here: sessions are
 * checked in the server, as before.
 */
export function middleware(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  // Everything but Next's static files and the media the CRM serves.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { mockGuard } from "@/lib/dev-guard";

/**
 * 1023 — El contrato de wallet del central (spec 016) en el mock de
 * desarrollo, con su camino infeliz. El final de la llave elige el caso:
 * `…0000` → 401, `…4031` → 403 `plan_without_wallet`, `…5030` → 503
 * `wallet_unavailable`, `…5000` → 500. Guarda cada cuerpo recibido para que
 * el e2e compruebe que ninguno lleva datos del cliente (AC11).
 */

export const MOCK_SCOPE = "cmocktest";
export const MOCK_PASS_TYPE_ID = "pass.center.into.stamps";
export const MOCK_TEAM_ID = "MOCKTEAM01";
export const MOCK_ISSUER_ID = "3388000000012345678";

type MockState = {
  bodies: { path: string; body: unknown }[];
  classes: Map<string, number>;
  objects: Map<string, number>;
};
const g = globalThis as unknown as { __centralWalletMock?: MockState };
export function mockState(): MockState {
  g.__centralWalletMock ??= { bodies: [], classes: new Map(), objects: new Map() };
  return g.__centralWalletMock;
}

const error = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

/** El guardia, la llave y el caso infeliz. Null = seguir. */
export function mockGate(req: Request): Response | null {
  const guard = mockGuard();
  if (guard) return guard;
  const key = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!key || key.endsWith("0000")) return error(401, "invalid_api_key", "Invalid or revoked license key");
  if (key.endsWith("4031")) return error(403, "plan_without_wallet", "The customer's plan does not include wallet");
  if (key.endsWith("5030")) return error(503, "wallet_unavailable", "Wallet is not configured in the central");
  if (key.endsWith("5000")) return new Response("boom", { status: 500 });
  return null;
}

export async function recordBody(req: Request, path: string): Promise<unknown> {
  const body = await req.json().catch(() => null);
  const state = mockState();
  state.bodies.push({ path, body });
  if (state.bodies.length > 500) state.bodies.shift();
  return body;
}

export { error as mockError };

import { mockError, mockGate, MOCK_SCOPE, recordBody } from "@/server/central/wallet-mock";

export const dynamic = "force-dynamic";

/**
 * 1023 — `POST /v1/wallet/apple/sign` del mock: revisa el manifiesto como el
 * central y devuelve una firma de mentira (el pase no abre en un iPhone).
 */
export async function POST(req: Request) {
  const gate = mockGate(req);
  if (gate) return gate;
  const body = (await recordBody(req, "apple/sign")) as { serial?: unknown; manifest?: unknown } | null;
  if (typeof body?.serial !== "string" || !body.serial.startsWith(`${MOCK_SCOPE}-`)) {
    return mockError(403, "wrong_scope", "The serial does not belong to this customer");
  }
  try {
    const manifest = JSON.parse(Buffer.from(String(body.manifest), "base64").toString("utf8")) as Record<string, string>;
    if (!manifest["pass.json"]) throw new Error("no pass.json");
  } catch {
    return mockError(422, "invalid_request", "Invalid manifest");
  }
  return Response.json({ signature: Buffer.from("mock-signature").toString("base64") });
}

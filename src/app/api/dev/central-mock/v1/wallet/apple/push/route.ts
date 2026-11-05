import { mockGate, recordBody } from "@/server/central/wallet-mock";

export const dynamic = "force-dynamic";

/** 1023 — `POST /v1/wallet/apple/push` del mock: los tokens que empiezan con `dead` son inválidos. */
export async function POST(req: Request) {
  const gate = mockGate(req);
  if (gate) return gate;
  const body = (await recordBody(req, "apple/push")) as { push_tokens?: string[] } | null;
  const tokens = Array.isArray(body?.push_tokens) ? body.push_tokens : [];
  const invalid = tokens.filter((t) => t.toLowerCase().startsWith("dead"));
  return Response.json({ sent: tokens.length - invalid.length, invalid });
}

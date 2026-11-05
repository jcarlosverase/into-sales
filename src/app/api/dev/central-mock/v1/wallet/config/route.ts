import { mockGate, MOCK_ISSUER_ID, MOCK_PASS_TYPE_ID, MOCK_SCOPE, MOCK_TEAM_ID } from "@/server/central/wallet-mock";

export const dynamic = "force-dynamic";

/** 1023 — `GET /v1/wallet/config` del mock del central. */
export async function GET(req: Request) {
  const gate = mockGate(req);
  if (gate) return gate;
  return Response.json({
    scope: MOCK_SCOPE,
    apple: { enabled: true, pass_type_id: MOCK_PASS_TYPE_ID, team_id: MOCK_TEAM_ID },
    google: { enabled: true, issuer_id: MOCK_ISSUER_ID },
  });
}

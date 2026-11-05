import { mockGate, mockState, MOCK_ISSUER_ID, MOCK_SCOPE, recordBody } from "@/server/central/wallet-mock";

export const dynamic = "force-dynamic";

/** 1023 — `PUT /v1/wallet/google/classes/{suffix}` del mock. */
export async function PUT(req: Request, { params }: { params: Promise<{ suffix: string }> }) {
  const gate = mockGate(req);
  if (gate) return gate;
  const { suffix } = await params;
  const body = (await recordBody(req, `google/classes/${suffix}`)) as { version?: number } | null;
  const version = Number(body?.version ?? 0);
  const state = mockState();
  state.classes.set(suffix, Math.max(state.classes.get(suffix) ?? 0, version));
  return Response.json({ id: `${MOCK_ISSUER_ID}.${MOCK_SCOPE}_${suffix}`, version: state.classes.get(suffix) });
}

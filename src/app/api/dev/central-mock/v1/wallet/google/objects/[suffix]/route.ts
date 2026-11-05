import { mockGate, mockState, recordBody } from "@/server/central/wallet-mock";

export const dynamic = "force-dynamic";

/** 1023 — `PATCH /v1/wallet/google/objects/{suffix}` del mock. */
export async function PATCH(req: Request, { params }: { params: Promise<{ suffix: string }> }) {
  const gate = mockGate(req);
  if (gate) return gate;
  const { suffix } = await params;
  const body = (await recordBody(req, `google/objects/${suffix}`)) as { version?: number } | null;
  const state = mockState();
  const saved = state.objects.has(suffix);
  const version = Number(body?.version ?? 0);
  if (saved) state.objects.set(suffix, Math.max(state.objects.get(suffix) ?? 0, version));
  return Response.json({ version, saved });
}

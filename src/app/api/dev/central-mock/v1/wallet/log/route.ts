import { mockGuard } from "@/lib/dev-guard";
import { mockState } from "@/server/central/wallet-mock";

export const dynamic = "force-dynamic";

/** 1023 — Lo que recibió el mock de wallet (para el e2e, AC11). DELETE lo vacía. */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json({ bodies: mockState().bodies });
}

export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  const state = mockState();
  state.bodies = [];
  state.classes.clear();
  state.objects.clear();
  return new Response(null, { status: 204 });
}

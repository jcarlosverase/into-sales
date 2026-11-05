import { mockError, mockGate, mockState, recordBody } from "@/server/central/wallet-mock";

export const dynamic = "force-dynamic";

/**
 * 1023 — `POST /v1/wallet/google/save-link` del mock. Da el objeto por
 * guardado al instante, como si el cliente hubiera tocado «Guardar».
 */
export async function POST(req: Request) {
  const gate = mockGate(req);
  if (gate) return gate;
  const body = (await recordBody(req, "google/save-link")) as { class_suffix?: string; object_suffix?: string } | null;
  const state = mockState();
  if (!body?.class_suffix || !state.classes.has(body.class_suffix)) {
    return mockError(409, "unknown_class", "Create the class first");
  }
  state.objects.set(String(body.object_suffix), 0);
  return Response.json({ url: `https://pay.google.com/gp/v/save/mock-${body.object_suffix}` });
}

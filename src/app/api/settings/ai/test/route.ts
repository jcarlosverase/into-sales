import { apiError, parseBody, withAuth } from "@/lib/api";
import { probeProvider } from "@/lib/ai/probe";
import { apiRoot } from "@/lib/ai/presets";
import { getAiCredentialPublic, markActive } from "@/server/ai/credentials";
import {
  aiProbeSchema,
  baseUrlEffective,
  keyForTest,
  viewSettingsIa,
} from "@/server/ai/settings";

export const dynamic = "force-dynamic";

/**
 * «Probar conexión»: una llamada mínima al proveedor con lo escrito en el
 * formulario, SIN guardar nada. Sin llave en el body se prueba la guardada;
 * si el proveedor la acepta y estaba pausada, vuelve a `active` — el camino
 * de «recargué saldo» sin pegar la misma llave otra vez.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, aiProbeSchema);
  if (!body.ok) return body.response;

  const key = await keyForTest(session.organizationId, body.data.token);
  if (!key) {
    return apiError(
      422,
      "sin_token",
      "Pega la llave del proveedor para probar la conexión"
    );
  }

  const baseUrl = baseUrlEffective(body.data.provider, body.data.baseUrl);
  const result = await probeProvider({
    baseUrl,
    model: body.data.model,
    token: key.token,
  });
  if (!result.ok) {
    const status =
      result.code === "unreachable" ||
      result.code === "timeout" ||
      result.code === "provider_error"
        ? 503
        : 422;
    return apiError(status, result.code, result.message);
  }

  let reactivated = false;
  if (key.saved) {
    const cred = await getAiCredentialPublic(session.organizationId);
    // Solo cuenta si se probó CONTRA EL MISMO proveedor que está guardado:
    // que otra base URL acepte la llave no dice nada de la pausada.
    if (
      cred &&
      cred.status !== "active" &&
      apiRoot(cred.baseUrl) === apiRoot(baseUrl)
    ) {
      await markActive(session.organizationId);
      reactivated = true;
    }
  }

  return Response.json({
    ok: true,
    latencyMs: result.latencyMs,
    reactivated: reactivated,
    view: reactivated ? await viewSettingsIa(session.organizationId) : null,
  });
});

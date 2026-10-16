import { apiError, parseBody, withAuth } from "@/lib/api";
import { listModels } from "@/lib/ai/probe";
import {
  aiModelsSchema,
  baseUrlEffective,
  keyForTest,
} from "@/server/ai/settings";

export const dynamic = "force-dynamic";

/**
 * «Traer modelos»: `GET {base}/v1/models` con la llave escrita (o la
 * guardada). Un proveedor que no publica la lista no es un error: se dice
 * (`soportado: false`) y el modelo se escribe a mano.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, aiModelsSchema);
  if (!body.ok) return body.response;

  const key = await keyForTest(session.organizationId, body.data.token);
  if (!key) {
    return apiError(
      422,
      "sin_token",
      "Pega la llave del proveedor para traer sus modelos"
    );
  }

  const baseUrl = baseUrlEffective(body.data.provider, body.data.baseUrl);
  const result = await listModels({ baseUrl, token: key.token });
  if (result.ok) {
    return Response.json({ supported: true, models: result.models });
  }
  if (result.code === "unsupported") {
    return Response.json({
      supported: false,
      models: [],
      message: result.message,
    });
  }
  const status =
    result.code === "invalid_token" || result.code === "bad_url" ? 422 : 503;
  return apiError(status, result.code, result.message);
});

import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { LICENSE_KEY_PATTERN } from "@/server/central/client";
import { centralDisabledResponse, readConfigCentral } from "@/server/central/flag";
import { beatNow } from "@/server/central/heartbeat";
import { getPublicLicense, saveKey, removeKey } from "@/server/central/license";

export const dynamic = "force-dynamic";

/**
 * 028 — Ajustes → Plan: la llave de licencia de into y lo último que dijo el
 * central. Sin la bandera `INTO_CENTRAL_URL`, 404. La llave entra una vez y
 * nunca vuelve a salir: la respuesta lleva sus últimos 4.
 */

async function view(organizationId: string) {
  const config = readConfigCentral();
  return {
    central: config.active ? config.host : null,
    license: await getPublicLicense(organizationId),
  };
}

const putSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(LICENSE_KEY_PATTERN, "La llave empieza con into_live_ y sigue con 32 letras y números"),
});

export const GET = withAuth(async (session) => {
  if (!readConfigCentral().active) return centralDisabledResponse();
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien configura el negocio");
  return Response.json(await view(session.organizationId));
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!readConfigCentral().active) return centralDisabledResponse();
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien configura el negocio");
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  await saveKey(session.organizationId, body.data.key);
  // AC3: late en ese momento; con el central caído responde igual (10 s de límite).
  await beatNow(session.organizationId);
  return Response.json(await view(session.organizationId));
});

export const DELETE = withAuth(async (session) => {
  if (!readConfigCentral().active) return centralDisabledResponse();
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo quien configura el negocio");
  await removeKey(session.organizationId);
  return Response.json(await view(session.organizationId));
});

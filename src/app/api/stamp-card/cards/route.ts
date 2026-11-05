import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { canSeeContact, getLeadScope } from "@/server/leads/scope";
import { ensureCard, getCardForContact } from "@/server/stamp-card/cards";
import { stampCardDisabledResponse, stampCardEnabled } from "@/server/stamp-card/flag";
import { cardView, stampCardErrorResponse } from "@/server/stamp-card/http";

export const dynamic = "force-dynamic";

/** 1023 — La tarjeta de un contacto (`?contactId=`), o `null` si no tiene. */
export const GET = withAuth(async (session, req: Request) => {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  const contactId = new URL(req.url).searchParams.get("contactId") ?? "";
  if (!contactId) return apiError(422, "invalid_query", "Falta contactId");
  if (!(await canSeeContact(getLeadScope(session), session.organizationId, contactId))) {
    return apiError(404, "not_found", "Contacto no encontrado");
  }
  const card = await getCardForContact(session.organizationId, contactId);
  return Response.json({
    card: card ? await cardView(session.organizationId, card, { withEvents: true }) : null,
    canAdjust: canConfigure(session.role),
  });
});

const createSchema = z.object({ contactId: z.string().min(1) }).strict();

/** D2 — Crear la tarjeta desde la ficha; si ya tiene una, la devuelve (200). */
export const POST = withAuth(async (session, req: Request) => {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;
  if (!(await canSeeContact(getLeadScope(session), session.organizationId, body.data.contactId))) {
    return apiError(404, "not_found", "Contacto no encontrado");
  }
  try {
    const { card, created } = await ensureCard(session.organizationId, body.data.contactId, {
      source: "panel",
      userId: session.userId,
    });
    return Response.json(
      { card: await cardView(session.organizationId, card, { withEvents: true }) },
      { status: created ? 201 : 200 }
    );
  } catch (err) {
    return stampCardErrorResponse(err);
  }
});

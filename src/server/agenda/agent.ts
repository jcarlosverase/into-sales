import {
  ANY_RESOURCE,
  resourceQuestion,
  type AgentResourceMode,
} from "@/lib/agenda-resources";
import { time12 } from "@/lib/time/slots";
import { computeAvailability } from "@/server/agenda/availability";
import { listActiveResources, type AgendaResource } from "@/server/agenda/resources";
import { getSettings } from "@/server/agenda/settings";
import { spreadByDay } from "@/server/agenda/spread";
import { replaceOffers } from "@/server/agenda/offers";
import { BookingError, createSessionBooking } from "@/server/agenda/service";

/**
 * 015 — Lo que el agente incluido puede hacer con la agenda.
 *
 * Vive aquí y no en el pipeline para que el pipeline no aprenda de agendas: el
 * turno pide "ofrece" o "reserva" y recibe el texto que hay que mandar.
 *
 * Regla que atraviesa las dos operaciones: el modelo NO redacta horarios. Pide
 * ofrecer, y el motor pega las etiquetas reales. Si el modelo inventa un
 * instante al reservar, el motor lo rechaza y se re-ofrece — nunca se agenda
 * algo que el cliente no eligió.
 */

/** Cuántos huecos se le enseñan al cliente en un mensaje. */
const SHOWN = 3;
/** Cuántos se guardan como reservables: el catálogo es más ancho que el menú. */
const OFFERED = 12;

export type AgendaTurn = {
  /** Lo que hay que enviarle al cliente. */
  text: string;
  /** false ⇒ el motor no pudo; el turno sigue, sin agendar. */
  ok: boolean;
};

/**
 * 1029 — Con quién ofrecer. `ask`: hay que preguntar antes. Con 2 o más
 * profesionales, en modo «Preguntar» y sin saber con quién, el motor pregunta
 * con los nombres reales; un id inventado cuenta como no saberlo.
 */
function targetOf(
  requested: string | null | undefined,
  resources: AgendaResource[],
  mode: AgentResourceMode
): { ask: true } | { ask: false; resource: AgendaResource | null } {
  const known = resources.find((r) => r.id === requested) ?? null;
  if (known) return { ask: false, resource: known };
  const mustAsk = mode === "ask" && resources.length >= 2 && requested !== ANY_RESOURCE;
  return mustAsk ? { ask: true } : { ask: false, resource: null };
}

export async function offerSlots(input: {
  organizationId: string;
  conversationId: string;
  intro?: string;
  /** 1029 — Un id, o `any` si al cliente le da igual. */
  resourceId?: string | null;
}): Promise<AgendaTurn> {
  const settings = await getSettings(input.organizationId);
  const resources = await listActiveResources(input.organizationId);
  const target = targetOf(input.resourceId, resources, settings.agentResourceMode);
  if (target.ask) {
    // Aún no hay nada que reservar: no se registra oferta.
    return { ok: true, text: resourceQuestion(resources) };
  }

  const now = new Date();
  let chosen = target.resource;
  let all = await computeAvailability(input.organizationId, {
    settings,
    now,
    resourceId: chosen?.id,
  });
  let unavailable = "";
  if (all.length === 0 && chosen) {
    // Esa persona no tiene huecos: se dice, y se ofrece a las demás.
    unavailable = `${chosen.name} no tiene horarios libres por ahora.`;
    chosen = null;
    all = await computeAvailability(input.organizationId, { settings, now });
  }
  const spread = spreadByDay(all, {
    timezone: settings.timezone,
    limit: OFFERED,
    perDay: 3,
    now,
  });

  if (spread.length === 0) {
    // Agenda llena no es un error: es una respuesta que el cliente entiende.
    return {
      ok: false,
      text:
        input.intro?.trim() ||
        "Por ahora no me quedan horarios libres. Déjame confirmarlo con el equipo y te aviso.",
    };
  }

  // Se REGISTRA todo el catálogo, no solo lo que se enseña: si el cliente pide
  // otro día, el agente tiene alternativas legítimas que aceptar.
  await replaceOffers(
    input.organizationId,
    input.conversationId,
    spread.map((s) => ({
      startUtc: s.startUtc,
      label: s.label,
      resourceId: chosen?.id ?? null,
    }))
  );

  const shown = spread.slice(0, SHOWN);
  const list = shown.map((s) => `• ${s.dayLabel} a las ${time12(s.time)}`).join("\n");
  const intro = unavailable
    ? `${unavailable} Con el resto del equipo tengo estos horarios:`
    : input.intro?.trim() ||
      (chosen ? `Con ${chosen.name} tengo estos horarios:` : "Tengo estos horarios disponibles:");
  return { ok: true, text: `${intro}\n${list}` };
}

export async function bookSlot(input: {
  organizationId: string;
  conversationId: string;
  startUtc: string;
  confirmation?: string;
  resourceId?: string | null;
}): Promise<AgendaTurn> {
  try {
    const result = await createSessionBooking({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      startUtc: input.startUtc,
      resourceId: input.resourceId === ANY_RESOURCE ? null : input.resourceId,
      source: "ai",
      requireOffer: true,
    });

    let base =
      input.confirmation?.trim() || `¡Listo! Te agendé para ${result.label}.`;
    // 1029 — Con una sola persona no hace falta decirlo.
    if (result.resource && (await listActiveResources(input.organizationId)).length >= 2) {
      base = `${base}\nTe atiende ${result.resource.name}.`;
    }
    if (result.meetingLink) {
      return { ok: true, text: `${base}\nEnlace: ${result.meetingLink}` };
    }
    if (result.linkPending) {
      // La cita existe; el enlace no. No se promete lo que no se tiene.
      return {
        ok: true,
        text: `${base}\nEn un momento te comparto el enlace por aquí.`,
      };
    }
    return { ok: true, text: base };
  } catch (err) {
    if (!(err instanceof BookingError)) throw err;

    // 1029 — Un profesional inventado o archivado: se vuelve a preguntar.
    if (err.code === "resource_not_found" || err.code === "resource_archived") {
      const again = await offerSlots({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
      });
      return { ok: false, text: again.text };
    }

    // Se ocupó o el modelo inventó la hora: en ambos casos se re-ofrece con
    // datos reales en vez de discutir con el cliente.
    if (err.slots.length > 0) {
      const list = err.slots
        .slice(0, SHOWN)
        .map((s) => `• ${s.label}`)
        .join("\n");
      const apology =
        err.code === "slot_taken"
          ? "Se me acaba de ocupar ese horario, ¡perdón!"
          : "Déjame confirmarte los horarios que tengo:";
      return { ok: false, text: `${apology}\n${list}` };
    }
    return {
      ok: false,
      text: "No pude agendarlo en este momento. Lo reviso con el equipo y te confirmo.",
    };
  }
}

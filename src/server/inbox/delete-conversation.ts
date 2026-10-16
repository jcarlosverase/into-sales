import { and, eq, gt, inArray, isNotNull, notExists, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { clearQualification } from "@/server/bot/qualification";
import type { EventChannel } from "@/server/brains/contract";
import { deleteMediaFile } from "@/server/whatsapp/media";

/**
 * 026 — Eliminar una conversación, por petición explícita de quien administra
 * el negocio.
 *
 * Dos alcances, porque son dos intenciones distintas:
 *
 * - `hilo`: se van los mensajes, sus adjuntos y la ficha. El contacto, su
 *   lugar en el pipeline y sus citas pasadas se quedan. Si la persona vuelve a
 *   escribir, es una conversación nueva.
 * - `contacto`: se va la persona entera. Todo lo que cuelga de ella cae en
 *   cascada, incluido su historial de etapas — los números de Resultados
 *   cambian, y por eso es una casilla aparte y no el comportamiento normal.
 *
 * Casi todo el trabajo lo hacen las foráneas con ON DELETE CASCADE. Lo que
 * este módulo añade es lo que una cascada no puede hacer: los adjuntos (fila y
 * archivo), la ficha y la cita por venir que detiene el borrado.
 */

export type DeletedScope = "hilo" | "contacto";

export type DeletedConversation = {
  id: string;
  channel: EventChannel;
};

export type ResultDelete =
  | {
      ok: true;
      scope: DeletedScope;
      organization: { id: string; slug: string | null };
      contact: { id: string; identity: string };
      /** En `hilo`, una. En `contacto`, todas las reales de esa persona. */
      conversations: DeletedConversation[];
    }
  | { ok: false; reason: "no_encontrada" }
  | { ok: false; reason: "cita_pendiente"; when: Date };

export async function deleteConversation(
  organizationId: string,
  conversationId: string,
  scope: DeletedScope
): Promise<ResultDelete> {
  const db = getDb();
  const files: string[] = [];

  const result = await db.transaction(async (tx): Promise<ResultDelete> => {
    const [org] = await tx
      .select({ id: schema.organization.id, slug: schema.organization.slug })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1);
    if (!org) return { ok: false, reason: "no_encontrada" };

    const [row] = await tx
      .select({
        conversation: schema.conversation,
        contact: schema.contact,
      })
      .from(schema.conversation)
      .innerJoin(
        schema.contact,
        and(
          eq(schema.contact.organizationId, schema.conversation.organizationId),
          eq(schema.contact.id, schema.conversation.contactId)
        )
      )
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          eq(schema.conversation.id, conversationId)
        )
      )
      // Dos personas eliminando a la vez: la segunda espera y luego no la
      // encuentra, en vez de borrar a medias.
      .for("update")
      .limit(1);
    // Una conversación del Laboratorio no vive en la bandeja: por aquí no
    // existe. Sus corridas se limpian desde el Laboratorio.
    if (!row || row.conversation.isTest) return { ok: false, reason: "no_encontrada" };
    const { contact } = row;
    const wholeContact = scope === "contacto";

    const conversations = wholeContact
      ? await tx
          .select()
          .from(schema.conversation)
          .where(
            scoped(
              schema.conversation.organizationId,
              organizationId,
              eq(schema.conversation.contactId, contact.id)
            )
          )
      : [row.conversation];
    const ids = conversations.map((c) => c.id);

    /**
     * Una cita por venir detiene el borrado, en los dos alcances.
     *
     * La cita sobrevive al hilo (`conversation_id` queda en NULL), pero su
     * recordatorio se manda POR la conversación: sin ella no saldría, y nadie
     * se enteraría. Y borrar el contacto se llevaría la cita de la base
     * dejando viva la reunión en Google o Zoom. Cancelar es el camino que
     * avisa a quien hay que avisar.
     */
    const [booking] = await tx
      .select({ when: schema.booking.scheduledAt })
      .from(schema.booking)
      .where(
        scoped(
          schema.booking.organizationId,
          organizationId,
          eq(schema.booking.status, "agendada"),
          eq(schema.booking.isTest, false),
          gt(schema.booking.scheduledAt, new Date()),
          wholeContact
            ? eq(schema.booking.contactId, contact.id)
            : eq(schema.booking.conversationId, conversationId)
        )
      )
      .orderBy(schema.booking.scheduledAt)
      .limit(1);
    if (booking) return { ok: false, reason: "cita_pendiente", when: booking.when };

    // Los adjuntos se anotan ANTES de borrar: después ya no hay mensaje que
    // diga cuáles eran.
    const ofMessages = await tx
      .selectDistinct({ id: schema.message.mediaAssetId })
      .from(schema.message)
      .where(
        scoped(
          schema.message.organizationId,
          organizationId,
          inArray(schema.message.conversationId, ids),
          isNotNull(schema.message.mediaAssetId)
        )
      );
    const fromAds = await tx
      .select({ id: schema.adAttribution.imageAssetId })
      .from(schema.adAttribution)
      .where(
        scoped(
          schema.adAttribution.organizationId,
          organizationId,
          inArray(schema.adAttribution.conversationId, ids),
          isNotNull(schema.adAttribution.imageAssetId)
        )
      );
    const candidates = [
      ...new Set(
        [...ofMessages, ...fromAds]
          .map((r) => r.id)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    if (wholeContact) {
      await tx
        .delete(schema.contact)
        .where(
          scoped(
            schema.contact.organizationId,
            organizationId,
            eq(schema.contact.id, contact.id)
          )
        );
    } else {
      await tx
        .delete(schema.conversation)
        .where(
          scoped(
            schema.conversation.organizationId,
            organizationId,
            eq(schema.conversation.id, conversationId)
          )
        );
      // La ficha es lo que el agente fue aprendiendo de esta persona, y viaja
      // al cerebro en cada turno: dejarla sería borrar el hilo y conservar
      // justo lo que el agente recordaba de él.
      await clearQualification(tx, organizationId, contact.id);
    }

    if (candidates.length > 0) {
      // Solo los adjuntos que ya nadie usa: la imagen de un anuncio puede
      // estar en otra conversación.
      const deleted = await tx
        .delete(schema.mediaAsset)
        .where(
          and(
            eq(schema.mediaAsset.organizationId, organizationId),
            inArray(schema.mediaAsset.id, candidates),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(schema.message)
                .where(eq(schema.message.mediaAssetId, schema.mediaAsset.id))
            ),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(schema.adAttribution)
                .where(eq(schema.adAttribution.imageAssetId, schema.mediaAsset.id))
            )
          )
        )
        .returning({ id: schema.mediaAsset.id });
      files.push(...deleted.map((a) => a.id));
    }

    return {
      ok: true,
      scope: scope,
      organization: org,
      contact: { id: contact.id, identity: contact.waIdentity },
      // Al cerebro solo se le avisa de las reales: de una de prueba nunca supo.
      conversations: conversations
        .filter((c) => !c.isTest)
        .map((c) => ({ id: c.id, channel: c.channel })),
    };
  });

  // Los archivos, DESPUÉS del commit: si la transacción se revierte, las
  // filas vuelven y sus archivos tienen que seguir ahí. Al revés solo queda
  // un archivo huérfano que nadie puede abrir, y no un mensaje sin adjunto.
  if (result.ok && files.length > 0) {
    const attempts = await Promise.allSettled(
      files.map((id) => deleteMediaFile(organizationId, id))
    );
    const failed = attempts.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      console.warn(
        `[bandeja] ${failed} de ${files.length} adjuntos no se pudieron borrar del volumen (${organizationId})`
      );
    }
  }

  return result;
}

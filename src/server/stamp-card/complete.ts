import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/observability/logger";
import { completeNotice } from "@/lib/stamp-card";
import { SendError, sendText } from "@/server/inbox/send";
import { sendTemplate } from "@/server/whatsapp/templates";
import { firstName } from "./join";

/**
 * 1023, D10 — Aviso por WhatsApp al COMPLETAR la tarjeta (viene apagado).
 * Con la ventana de 24 horas abierta va texto libre; cerrada, la plantilla de
 * utilidad que eligió el negocio, con `{{1}}` nombre, `{{2}}` negocio y
 * `{{3}}` premio (las que use). Sin plantilla y con la ventana cerrada, no
 * se manda nada. Nunca lanza: el sello ya está guardado.
 */
export type CompleteNotice = "sent_text" | "sent_template" | "skipped" | "failed";

export async function notifyCardComplete(organizationId: string, cardId: string): Promise<CompleteNotice> {
  try {
    const db = getDb();
    const [row] = await db
      .select({ program: schema.stampProgram, contactId: schema.stampCard.contactId, contactName: schema.contact.name })
      .from(schema.stampCard)
      .innerJoin(schema.stampProgram, eq(schema.stampProgram.id, schema.stampCard.programId))
      .innerJoin(schema.contact, eq(schema.contact.id, schema.stampCard.contactId))
      .where(scoped(schema.stampCard.organizationId, organizationId, eq(schema.stampCard.id, cardId)))
      .limit(1);
    if (!row || !row.program.notifyOnComplete) return "skipped";
    const [conversation] = await db
      .select({ id: schema.conversation.id })
      .from(schema.conversation)
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          and(eq(schema.conversation.contactId, row.contactId), eq(schema.conversation.channel, "whatsapp"))
        )
      )
      .orderBy(desc(schema.conversation.lastInboundAt))
      .limit(1);
    if (!conversation) return "skipped";

    const nombre = firstName(row.contactName);
    const values = { nombre, negocio: row.program.name, premio: row.program.reward };
    try {
      await sendText({ conversationId: conversation.id, organizationId, text: completeNotice(values) });
      return "sent_text";
    } catch (err) {
      if (!(err instanceof SendError) || err.code !== "window_closed") throw err;
    }
    if (!row.program.completeTemplateId) return "skipped";
    await sendTemplate({
      organizationId,
      conversationId: conversation.id,
      templateId: row.program.completeTemplateId,
      variables: [nombre || "Hola", values.negocio, values.premio],
    });
    return "sent_template";
  } catch (err) {
    logger.warn(
      { event: "stamp_card.complete_notice_failed", name: err instanceof Error ? err.name : "Error" },
      "[stamp-card] no se pudo avisar la tarjeta completa"
    );
    return "failed";
  }
}

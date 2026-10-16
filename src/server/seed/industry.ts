import { and, asc, eq, inArray, isNull, like } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { assignLeadByRotation } from "@/server/leads/routing";
import type { IndustrySample } from "@/server/seed/industries/types";
import { academy } from "@/server/seed/industries/academy";
import { realEstate } from "@/server/seed/industries/real-estate";
import { fashion } from "@/server/seed/industries/fashion";
import {
  isLegacyDemoAgent,
  removeLegacyDemo,
  type LegacyCleanup,
} from "@/server/seed/legacy-demo";

/**
 * 027 — Loads (or removes) one industry's sample data: contacts with their
 * conversations and leads, WhatsApp template drafts, and the AI agent's
 * profile and knowledge. See specs/027-datos-de-ejemplo-por-rubro/spec.md.
 *
 * Safe to repeat and never touches real data:
 * - sample contacts are recognised by their identity `sample:<industry>:<n>`
 *   and have no phone, so nothing can ever be sent to them (D2, D3);
 * - templates go in as drafts and never overwrite one already sent to Meta (D4);
 * - knowledge entries are only added when an identical one is missing (D5);
 * - the agent profile is only filled while nobody configured it (D6).
 */

type Db = ReturnType<typeof getDb>;

const HOURS = 60 * 60 * 1000;

export const INDUSTRIES: Record<IndustrySample["key"], IndustrySample> = {
  academy,
  realestate: realEstate,
  fashion,
};

export function isIndustryKey(value: string): value is IndustrySample["key"] {
  return value in INDUSTRIES;
}

/** Identity of the n-th sample contact of an industry (n starts at 1). */
export function sampleIdentity(key: IndustrySample["key"], n: number): string {
  return `sample:${key}:${n}`;
}

function sampleIdentityPattern(key: IndustrySample["key"]): string {
  return `sample:${key}:%`;
}

export type SeedResult = {
  contacts: number;
  /** Templates inserted or refreshed as drafts. */
  templates: number;
  /** Templates left alone because they were already sent to Meta. */
  templatesSkipped: string[];
  knowledgeAdded: number;
  agent: "applied" | "kept";
  /** Leads that went to a rep through the rotation (spec 022). */
  assigned: number;
  /** Hardware-store demo leftovers removed on the way (see legacy-demo.ts). */
  legacy: LegacyCleanup;
};

/** Deletes this industry's sample contacts (cascade: conversations, messages, leads…). */
async function removeSampleContacts(
  db: Db,
  organizationId: string,
  key: IndustrySample["key"]
): Promise<number> {
  const removed = await db
    .delete(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        like(schema.contact.waIdentity, sampleIdentityPattern(key)),
        // Belt and braces: a sample contact never has a phone (D3).
        isNull(schema.contact.phone)
      )
    )
    .returning({ id: schema.contact.id });
  return removed.length;
}

/** Deletes this industry's template drafts (never one already sent to Meta). */
async function removeSampleTemplates(
  db: Db,
  organizationId: string,
  sample: IndustrySample
): Promise<number> {
  const removed = await db
    .delete(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        organizationId,
        inArray(
          schema.template.name,
          sample.templates.map((t) => t.name)
        ),
        eq(schema.template.status, "draft")
      )
    )
    .returning({ id: schema.template.id });
  return removed.length;
}

/** `--reset`: removes the industry's sample contacts and template drafts (D8). */
export async function resetIndustry(
  db: Db,
  organizationId: string,
  sample: IndustrySample
): Promise<{ contacts: number; templates: number }> {
  return {
    contacts: await removeSampleContacts(db, organizationId, sample.key),
    templates: await removeSampleTemplates(db, organizationId, sample),
  };
}

async function seedContacts(
  db: Db,
  organizationId: string,
  sample: IndustrySample
): Promise<{ contacts: number; assigned: number }> {
  await removeSampleContacts(db, organizationId, sample.key);

  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));
  const stageByName = new Map(stages.map((s) => [s.name, s.id]));
  const firstOpen = stages.find((s) => s.kind === "open")?.id ?? stages[0]?.id;
  if (!firstOpen) throw new Error("La organización no tiene etapas en el Pipeline");

  const now = Date.now();
  let assigned = 0;

  for (const [index, item] of sample.contacts.entries()) {
    const contactId = newId("contact");
    await db.insert(schema.contact).values({
      id: contactId,
      organizationId,
      waIdentity: sampleIdentity(sample.key, index + 1),
      phone: null,
      name: item.name,
      nameSource: "manual",
      notes: item.notes ?? null,
      source: item.source ?? null,
    });

    const lastMessageHours = Math.min(...item.thread.map((m) => m.hoursAgo));
    const inbound = item.thread.filter((m) => m.dir === "in");
    const lastInboundHours = inbound.length
      ? Math.min(...inbound.map((m) => m.hoursAgo))
      : null;

    const conversationId = newId("conversation");
    await db.insert(schema.conversation).values({
      id: conversationId,
      organizationId,
      contactId,
      lastInboundAt: lastInboundHours === null ? null : new Date(now - lastInboundHours * HOURS),
      lastMessageAt: new Date(now - lastMessageHours * HOURS),
      unreadCount: item.thread.at(-1)?.dir === "in" ? 1 : 0,
    });

    for (const msg of item.thread) {
      const at = new Date(now - msg.hoursAgo * HOURS);
      await db.insert(schema.message).values({
        id: newId("message"),
        organizationId,
        conversationId,
        waMessageId: `wamid.sample.${newId("message")}`,
        direction: msg.dir,
        type: "text",
        text: msg.text,
        status: msg.dir === "in" ? "delivered" : "read",
        aiGenerated: msg.ai ?? false,
        origin: msg.ai ? "ai" : "operator",
        waTimestamp: at,
        createdAt: at,
      });
    }

    const leadId = newId("lead");
    await db.insert(schema.lead).values({
      id: leadId,
      organizationId,
      contactId,
      stageId: stageByName.get(item.stage) ?? firstOpen,
      position: index,
      amountCents: item.amountCents ?? null,
      currency: item.amountCents === undefined ? null : sample.currency,
      priority: item.priority ?? null,
      priorityUpdatedAt: item.priority ? new Date(now) : null,
      lastActivityAt: new Date(now - lastMessageHours * HOURS),
    });

    // D7 — sample leads go through the rotation like any new lead.
    if (await assignLeadByRotation(organizationId, leadId, db)) assigned++;
  }

  return { contacts: sample.contacts.length, assigned };
}

async function seedTemplates(
  db: Db,
  organizationId: string,
  sample: IndustrySample
): Promise<{ templates: number; skipped: string[] }> {
  let templates = 0;
  const skipped: string[] = [];
  for (const t of sample.templates) {
    const [existing] = await db
      .select({ id: schema.template.id, status: schema.template.status })
      .from(schema.template)
      .where(
        scoped(
          schema.template.organizationId,
          organizationId,
          eq(schema.template.name, t.name),
          eq(schema.template.language, t.language)
        )
      )
      .limit(1);

    if (existing && existing.status !== "draft") {
      // Already sent to Meta (pending, approved or rejected): not ours to touch (D4).
      skipped.push(t.name);
      continue;
    }
    if (existing) {
      await db
        .update(schema.template)
        .set({ category: t.category, body: t.body, updatedAt: new Date() })
        .where(eq(schema.template.id, existing.id));
    } else {
      await db.insert(schema.template).values({
        id: newId("template"),
        organizationId,
        name: t.name,
        language: t.language,
        category: t.category,
        body: t.body,
        status: "draft",
      });
    }
    templates++;
  }
  return { templates, skipped };
}

async function seedKnowledge(
  db: Db,
  organizationId: string,
  sample: IndustrySample
): Promise<number> {
  const current = await db
    .select({
      kind: schema.kbEntry.kind,
      question: schema.kbEntry.question,
      answer: schema.kbEntry.answer,
      content: schema.kbEntry.content,
    })
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId));
  const fingerprint = (e: {
    kind: string;
    question?: string | null;
    answer?: string | null;
    content?: string | null;
  }) => JSON.stringify([e.kind, e.question ?? null, e.answer ?? null, e.content ?? null]);
  const present = new Set(current.map(fingerprint));

  let added = 0;
  for (const entry of sample.knowledge) {
    const row =
      entry.kind === "block"
        ? { kind: entry.kind, question: null, answer: null, content: entry.content }
        : { kind: entry.kind, question: entry.question, answer: entry.answer, content: null };
    if (present.has(fingerprint(row))) continue;
    await db.insert(schema.kbEntry).values({ id: newId("kbEntry"), organizationId, ...row });
    present.add(fingerprint(row));
    added++;
  }
  return added;
}

/** Was the agent profile ever configured? (Any of its texts set.) */
export function isAgentConfigured(profile: {
  tone: string | null;
  instructions: string | null;
  escalationRules: string | null;
  greeting: string | null;
}): boolean {
  return [profile.tone, profile.instructions, profile.escalationRules, profile.greeting].some(
    (v) => !!v?.trim()
  );
}

async function seedAgent(
  db: Db,
  organizationId: string,
  sample: IndustrySample,
  overwrite: boolean
): Promise<"applied" | "kept"> {
  const [profile] = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);

  // The old hardware-store demo's profile is sample data too: replace it.
  if (profile && isAgentConfigured(profile) && !isLegacyDemoAgent(profile) && !overwrite) {
    return "kept";
  }

  const values = { ...sample.agent, updatedAt: new Date() };
  if (profile) {
    // `enabled` is left as it is (D6): loading samples never turns the agent on.
    await db
      .update(schema.agentProfile)
      .set(values)
      .where(and(eq(schema.agentProfile.organizationId, organizationId)));
  } else {
    await db
      .insert(schema.agentProfile)
      .values({ id: newId("agentProfile"), organizationId, ...values });
  }
  return "applied";
}

export async function seedIndustry(
  db: Db,
  organizationId: string,
  sample: IndustrySample,
  options: { overwriteAgent?: boolean } = {}
): Promise<SeedResult> {
  const legacy = await removeLegacyDemo(db, organizationId);
  const { contacts, assigned } = await seedContacts(db, organizationId, sample);
  const { templates, skipped } = await seedTemplates(db, organizationId, sample);
  const knowledgeAdded = await seedKnowledge(db, organizationId, sample);
  const agent = await seedAgent(db, organizationId, sample, options.overwriteAgent ?? false);
  return {
    contacts,
    templates,
    templatesSkipped: skipped,
    knowledgeAdded,
    agent,
    assigned,
    legacy,
  };
}

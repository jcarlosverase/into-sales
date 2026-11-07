import type { AgentResourceMode, ResourceKind } from "@/lib/agenda-resources";
import type { WeeklyHours } from "@/server/agenda/settings";

/**
 * 023 — Sample data for one industry: what `pnpm seed:<industry>` loads.
 * Texts are in Spanish (Lima, soles); identifiers in English.
 */

export type SampleMessage = {
  dir: "in" | "out";
  text: string;
  hoursAgo: number;
  /** Outbound written by the AI agent (otherwise by a person). */
  ai?: boolean;
};

export type SampleContact = {
  name: string;
  /** Name of a default pipeline stage; falls back to the first open stage. */
  stage: "Nuevo" | "En conversación" | "Interesado" | "Cliente" | "Perdido";
  notes?: string;
  source?: "anuncio" | "organico" | "referido" | "conocido" | "otro";
  priority?: "alta" | "media" | "baja";
  /** Deal amount in céntimos (PEN). */
  amountCents?: number;
  thread: SampleMessage[];
};

export type SampleTemplate = {
  /** Meta-style name: lowercase, digits and underscores. Prefixed per industry. */
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  body: string;
};

export type SampleKbEntry =
  | { kind: "block"; content: string }
  | { kind: "qa"; question: string; answer: string };

export type SampleAgent = {
  name: string;
  tone: string;
  instructions: string;
  escalationRules: string;
  greeting: string;
};

/** 1029 — A professional (or room) the agenda books with. */
export type SampleAgendaResource = {
  /** What the client reads: 1–60 characters, unique per business. */
  name: string;
  kind: ResourceKind;
  /** Must fit inside the business hours (spec 1029, AC3). */
  weeklyHours: WeeklyHours;
};

/** 1029 — The business agenda and its professionals. */
export type SampleAgenda = {
  /** Business hours; only written when the agenda was never configured. */
  weeklyHours: WeeklyHours;
  slotMinutes: number;
  agentResourceMode: AgentResourceMode;
  resources: SampleAgendaResource[];
};

export type IndustrySample = {
  /** CLI key and identity prefix: `sample:<key>:<n>`. */
  key: "academy" | "realestate" | "fashion" | "dental";
  /** Business name shown in the summary. */
  businessName: string;
  currency: "PEN";
  contacts: SampleContact[];
  templates: SampleTemplate[];
  knowledge: SampleKbEntry[];
  agent: SampleAgent;
  /** Only industries that book appointments bring one. */
  agenda?: SampleAgenda;
};

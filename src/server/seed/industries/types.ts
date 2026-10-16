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

export type IndustrySample = {
  /** CLI key and identity prefix: `sample:<key>:<n>`. */
  key: "academy" | "realestate" | "fashion";
  /** Business name shown in the summary. */
  businessName: string;
  currency: "PEN";
  contacts: SampleContact[];
  templates: SampleTemplate[];
  knowledge: SampleKbEntry[];
  agent: SampleAgent;
};

/**
 * 1029 — Reglas puras de los profesionales o recursos de la agenda. Sin base de
 * datos ni Next: las comparten el servidor y las pantallas.
 */

export const RESOURCE_KINDS = ["person", "resource"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const AGENT_RESOURCE_MODES = ["first_free", "ask"] as const;
export type AgentResourceMode = (typeof AGENT_RESOURCE_MODES)[number];

export const DEFAULT_AGENT_RESOURCE_MODE: AgentResourceMode = "first_free";

/** Lo que manda `offer_slots` o el bot cuando al cliente le da igual con quién. */
export const ANY_RESOURCE = "any";

export const RESOURCE_NAME_MAX = 60;

export type ResourceRef = { id: string; name: string; kind: ResourceKind };

/** «Primero libre»: uno al azar entre quienes están libres en ese instante. */
export function pickResource<T extends { id: string }>(
  freeIds: readonly string[],
  resources: readonly T[],
  random: () => number = Math.random
): T | null {
  const free = resources.filter((r) => freeIds.includes(r.id));
  return free[Math.floor(random() * free.length)] ?? null;
}

/**
 * ¿Lo pedido cuadra con lo ofrecido? La oferta manda: si se ofreció con alguien,
 * solo vale esa persona; si se ofreció con cualquiera, vale quien se pida.
 */
export function offerMatches(
  offered: string | null | undefined,
  requested: string | null | undefined
): boolean {
  if (!offered || !requested) return true;
  return offered === requested;
}

/** «Dra. Ana, Dr. Luis o Sala 3». */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} o ${names[names.length - 1]}`;
}

/** La pregunta la hace el motor, con los nombres reales: el modelo no los redacta. */
export function resourceQuestion(resources: readonly { name: string; kind: ResourceKind }[]): string {
  const list = joinNames(resources.map((r) => r.name));
  return resources.every((r) => r.kind === "resource")
    ? `¿Cuál prefieres: ${list}?`
    : `¿Con quién prefieres atenderte: ${list}?`;
}

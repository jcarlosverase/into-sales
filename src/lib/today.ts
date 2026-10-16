/**
 * 029 — «A quién llamar hoy»: fechas, opciones de «Hecho» y orden. Puro y sin
 * dependencias de servidor: lo usan la consulta, la pantalla y el cajón.
 */

export type Priority = "alta" | "media" | "baja";

/** «AAAA-MM-DD» + n días, en calendario (sin zonas: es un día, no un instante). */
export function addDays(isoDate: string, days: number): string {
  const ts = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(ts)) return isoDate;
  return new Date(ts + days * 86_400_000).toISOString().slice(0, 10);
}

/** Una fecha real con forma `AAAA-MM-DD` (no `2026-02-30`). */
export function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export type FollowUpChoice = { label: string; value: string | null };

/** D5 — Lo que ofrece «Hecho», contado desde hoy del negocio. */
export function followUpChoices(today: string): FollowUpChoice[] {
  return [
    { label: "Mañana", value: addDays(today, 1) },
    { label: "En 3 días", value: addDays(today, 3) },
    { label: "En una semana", value: addDays(today, 7) },
    { label: "Sin fecha", value: null },
  ];
}

/** Alta primero; sin prioridad al final. */
export const PRIORITY_RANK: Record<Priority | "none", number> = { alta: 0, media: 1, baja: 2, none: 3 };

export type TodaySectionId = "overdue" | "today" | "first_contact";

export const TODAY_SECTION_LABELS: Record<TodaySectionId, string> = {
  overdue: "Vencidos",
  today: "Para hoy",
  first_contact: "Sin primer contacto",
};

type Sortable = { name: string; priority: Priority | null; followUpOn: string | null; createdAt: string };

const byPriority = (a: Sortable, b: Sortable) =>
  PRIORITY_RANK[a.priority ?? "none"] - PRIORITY_RANK[b.priority ?? "none"];

/** D3 — El orden de cada sección. */
export function sortSection<T extends Sortable>(id: TodaySectionId, items: T[]): T[] {
  const copy = [...items];
  if (id === "overdue") {
    return copy.sort((a, b) => (a.followUpOn ?? "").localeCompare(b.followUpOn ?? "") || byPriority(a, b) || a.name.localeCompare(b.name, "es"));
  }
  if (id === "today") return copy.sort((a, b) => byPriority(a, b) || a.name.localeCompare(b.name, "es"));
  return copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name, "es"));
}

/** «hace 3 días», «ayer» — cuánto se atrasó un seguimiento. */
export function overdueLabel(followUpOn: string, today: string): string {
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${followUpOn}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${days} días`;
}

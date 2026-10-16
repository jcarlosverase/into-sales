import {
  CalendarDays,
  ChartColumn,
  FlaskConical,
  Inbox,
  Kanban,
  ListChecks,
  Settings,
  Sparkles,
  Users,
  type LucideIcon, PhoneCall } from "lucide-react";
import { canConfigure } from "@/lib/auth/roles";

/**
 * #87 — El modelo del menú, separado del componente que lo pinta.
 *
 * Qué entradas existen lo deciden dos cosas que el nav de cliente no puede
 * leer solo: las banderas de la instancia (`AGENDA`, `CHANNELS`, `ATRIBUCION`,
 * que bajan por prop desde el servidor) y el rol de quien mira. Tenerlo aquí,
 * sin React, deja que una prueba unitaria afirme qué aparece y qué no sin
 * dibujar nada.
 */

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Muestra el contador de no leídos (solo la Bandeja). */
  badge?: boolean;
};

export type NavGroup = {
  /** Encabezado pequeño; sin él, el grupo es una entrada suelta. */
  title?: string;
  items: NavItem[];
};

/** La única entrada que va abajo, separada del resto. */
export const SETTINGS_ITEM: NavItem = {
  href: "/settings",
  label: "Ajustes",
  icon: Settings,
};

/**
 * Grupos de la barra lateral, en el orden en que se leen: lo que se atiende
 * cada día, lo que configura al agente y, al final, cómo va el negocio.
 */
export function appNavGroups({
  agenda = false,
  role,
}: {
  /** 015 — "Citas" solo existe si esta instancia encendió la agenda. */
  agenda?: boolean;
  /** #86 — La guía de inicio solo para quien puede configurar. */
  role?: string | null;
}): NavGroup[] {
  const work: NavItem[] = [
    // 029 — lo primero que abre un vendedor al empezar el día.
    { href: "/today", label: "Hoy", icon: PhoneCall },
    { href: "/inbox", label: "Bandeja", icon: Inbox, badge: true },
    { href: "/pipeline", label: "Pipeline", icon: Kanban },
    { href: "/contacts", label: "Contactos", icon: Users },
  ];
  // Citas va después de Contactos: es el paso siguiente de un trato, no una
  // sección aparte.
  if (agenda) work.push({ href: "/bookings", label: "Citas", icon: CalendarDays });

  const agent: NavItem[] = [];
  // Un miembro del equipo no puede hacer ninguno de los pasos de la guía.
  if (canConfigure(role)) {
    agent.push({ href: "/onboarding", label: "Guía de inicio", icon: ListChecks });
  }
  agent.push(
    { href: "/agent", label: "Agente", icon: Sparkles },
    { href: "/lab", label: "Laboratorio", icon: FlaskConical }
  );

  return [
    { title: "Trabajo", items: work },
    { title: "Agente", items: agent },
    // 019 — Se mide al final: primero se atiende y se organiza.
    { items: [{ href: "/results", label: "Resultados", icon: ChartColumn }] },
  ];
}

export type SettingsLink = { href: string; label: string };

export type SettingsSection = {
  title: string;
  links: SettingsLink[];
};

/**
 * Ajustes en tres secciones: por dónde entran los mensajes, qué hace el agente
 * con ellos y lo que es del negocio. Una pestaña por canal no escala; una
 * sección por canal, sí: cada canal nuevo cae en "Canales" sin tocar el resto.
 *
 * Instagram no tiene pantalla propia todavía: sus credenciales se guardan
 * por API (`/api/settings/instagram`). Cuando la tenga, va aquí tras
 * `CHANNELS`, igual que Messenger.
 */
export function settingsSections({
  agenda = false,
  atribucion: attribution = false,
  central = false,
  instagram = false,
  messenger = false,
  tiktok = false,
}: {
  agenda?: boolean;
  /** 016 — "Anuncios" existe solo con la bandera ATRIBUCION. */
  atribucion?: boolean;
  /** 028 — "Plan" existe solo con la bandera INTO_CENTRAL_URL. */
  central?: boolean;
  /** 023 — "Instagram" solo si el canal está encendido con CHANNELS. */
  instagram?: boolean;
  /** 017 — "Messenger", igual. */
  messenger?: boolean;
  /** 022 — "TikTok", igual: solo con el canal en CHANNELS. */
  tiktok?: boolean;
}): SettingsSection[] {
  const channels: SettingsLink[] = [];
  // 023 — "Estado" reúne todos los canales; con WhatsApp solo no aporta nada
  // que su pantalla no diga, así que no existe (ADR-001).
  if (instagram || messenger || tiktok) {
    channels.push({ href: "/settings/channels", label: "Estado" });
  }
  channels.push({ href: "/settings/whatsapp", label: "WhatsApp" });
  if (instagram) channels.push({ href: "/settings/instagram", label: "Instagram" });
  if (messenger) channels.push({ href: "/settings/messenger", label: "Messenger" });
  if (tiktok) channels.push({ href: "/settings/tiktok", label: "TikTok" });

  // #85 — el proveedor de IA se configura aquí; el entorno queda de respaldo.
  const agent: SettingsLink[] = [{ href: "/settings/ai", label: "IA" }];
  if (agenda) agent.push({ href: "/settings/calendar", label: "Agenda" });

  const business: SettingsLink[] = [
    { href: "/settings/branding", label: "Marca" },
    { href: "/settings/templates", label: "Plantillas" },
    { href: "/settings/team", label: "Equipo" },
  ];
  if (attribution) business.push({ href: "/settings/ads", label: "Anuncios" });
  if (central) business.push({ href: "/settings/central", label: "Plan" });

  return [
    { title: "Canales", links: channels },
    { title: "Agente", links: agent },
    { title: "Negocio", links: business },
    // 1004 — la salud del propio CRM: base de datos, migraciones y servicios.
    { title: "Sistema", links: [{ href: "/settings/health", label: "Salud" }] },
  ];
}

/** Activa si la ruta es la entrada o cuelga de ella (`/inbox/cv_123`). */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

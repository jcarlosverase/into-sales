import type { SessionContext } from "@/lib/auth/session";
import { canConfigure } from "@/lib/auth/roles";
import {
  onboardingStatus,
  type OnboardingStatus,
  type ReadinessStep,
} from "./status";

/**
 * La guía de inicio: tres pasos (cuatro con la agenda) y nada más (issue #86).
 *
 * Es lo primero que ve quien instala Vocero: configurar el agente, vincular
 * el proveedor de IA, conectar el número y, si la agenda existe en esta
 * instancia, dejarla lista. Al terminar, un botón enciende el agente. Lo
 * demás —la Bandeja, el Pipeline— ya está en el menú; la guía no lo repite.
 *
 * El estado de cada paso sale de `onboardingStatus`, la misma fuente que ya
 * verifica cada conexión: la guía no inventa su propia noción de «listo».
 * Puerto de `onboarding/guide.ts` de Vocero Cloud sin lo que allá es de la
 * plataforma (modelo fijado por soporte, agencias, planes).
 */
export type GuideStep = {
  key: "agent" | "ai" | "whatsapp" | "calendar";
  title: string;
  description: string;
  done: boolean;
  href: string;
  cta: string;
  /** Lo que falta, cuando no es lo obvio del paso. */
  hint: string | null;
};

export type Guide = {
  steps: GuideStep[];
  complete: boolean;
  /** El agente ya está encendido. */
  enabled: boolean;
};

const ready = (s: ReadinessStep | undefined) => s?.status === "ready";

/** Pura: de los pasos verificados a los de la guía. */
export function guideFrom(status: OnboardingStatus): Guide {
  const step = (key: ReadinessStep["key"]) =>
    status.steps.find((s) => s.key === key);
  const profile = step("profile");
  const ai = step("ai");
  const whatsapp = step("whatsapp");
  const calendar = step("calendar");

  const steps: GuideStep[] = [
    {
      key: "agent",
      title: "Configura tu agente",
      description:
        "Ponle nombre y cuéntale a qué se dedica tu negocio. Si quieres ver un ejemplo primero, carga la demo desde la Bandeja y cámbiala por tus datos.",
      done: ready(profile),
      href: "/agent",
      cta: "Ir a Agente",
      hint: ready(profile) ? null : (profile?.nextAction ?? null),
    },
    {
      key: "ai",
      title: "Vincula tu proveedor de IA",
      description:
        "Es la cuenta con la que tu agente piensa: OpenRouter o cualquier proveedor compatible con la API de OpenAI. La creas y la pagas tú; aquí solo pegas la llave y eliges el modelo.",
      done: ready(ai),
      href: "/settings/ai",
      cta: "Vincular proveedor",
      hint: ai?.problem ?? null,
    },
    {
      key: "whatsapp",
      title: "Vincula tu número de WhatsApp",
      description:
        "Conecta el número donde te escriben tus clientes. El CRM registra el webhook en Meta por ti al guardar.",
      done: ready(whatsapp),
      href: "/settings/whatsapp",
      cta: "Conectar WhatsApp",
      hint: whatsapp?.problem ?? null,
    },
  ];
  // Sin agenda en esta instancia el paso no existe: pintarlo «no aplica»
  // sería justo el tipo de ruido que la guía evita.
  if (calendar && calendar.status !== "not_applicable") {
    steps.push({
      key: "calendar",
      title: "Configura tu agenda",
      description:
        "Define tus horarios y cómo se entrega la reunión para que tu agente pueda agendar por ti.",
      done: ready(calendar),
      href: "/settings/calendar",
      cta: "Configurar agenda",
      hint: calendar.problem,
    });
  }
  return { steps, complete: steps.every((s) => s.done), enabled: status.enabled };
}

export async function guideStatus(organizationId: string): Promise<Guide> {
  return guideFrom(await onboardingStatus(organizationId));
}

/**
 * ¿La guía es lo primero que ve esta persona al entrar?
 *
 * Solo a quien puede configurar (un miembro del equipo no puede hacer ninguno
 * de los pasos) y solo mientras falte algo: con todos los pasos listos y el
 * agente encendido se entra directo a la Bandeja, como siempre.
 *
 * Un negocio demo recién sembrado («Academia Horizonte») pasa por aquí
 * igual: el seed deja el agente configurado (paso 1 listo) pero no puede
 * vincular una llave de IA ni un número, y sin eso el agente no contesta.
 * Capturar `/` no encierra a nadie: el menú lleva a cualquier pantalla.
 */
export async function guideFirst(
  session: Pick<SessionContext, "organizationId" | "role">
): Promise<boolean> {
  if (!canConfigure(session.role)) return false;
  const guide = await guideStatus(session.organizationId);
  return !guide.complete || !guide.enabled;
}

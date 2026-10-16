/**
 * Quién puede CONFIGURAR la instancia: conectar el número, pegar la llave de
 * IA, escribir el agente, encenderlo. En la raíz son dos roles: el `owner`
 * que crea la organización en el primer registro y el `admin` que Better Auth
 * conoce (hoy nadie lo asigna, pero es un rol de configuración y no de
 * operación). Un `member` del equipo atiende la Bandeja: no puede hacer
 * ninguno de los pasos de la guía de inicio, así que no se le enseña.
 *
 * Vive en `lib/` porque lo consultan los dos lados: el menú (cliente) y la
 * redirección de la raíz (servidor).
 */
export function canConfigure(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * 022 — Supervisors see every lead, assign them and configure lead routing.
 * Today it is the same pair as `canConfigure`, but the question is different
 * ("who sees the whole team's work?"), so it gets its own name.
 */
export function isSupervisor(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** 022 — The role that receives leads by rotation and only sees its own. */
export const SALES_REP_ROLE = "member";

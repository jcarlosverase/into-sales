# 1026 — Tope absoluto de 7 días a la sesión

**Created**: 2026-11-05

**Status**: Implementada; pruebas con Better Auth real contra PostgreSQL en verde.

**Input**: Juan Carlos el 2026-11-05: «tope absoluto de 7 días a la sesión,
además de las 12 horas sin uso».

**Carril**: ligero. Sin migración: `session.created_at` ya existe. Amplía la
spec [1018](../1018-session-inactivity/spec.md).

## Problema

La 1018 cierra la sesión tras 12 horas sin uso, pero quien la usa a diario la
renueva sin fin: en un teléfono o una computadora compartida el CRM podía quedar
abierto meses. Una contraseña cambiada o un teléfono perdido no se notaban.

## Comportamiento y criterios de aceptación

- **AC1** — A los 7 días de haber entrado, la sesión vence aunque se use todos
  los días, y la siguiente navegación lleva al inicio de sesión.
- **AC2** — Antes de eso nada cambia: mientras alguien trabaja la sesión se
  renueva y cada renovación vuelve a contar 12 horas.
- **AC3** — En el último tramo, la renovación no pasa de los 7 días.
- **AC4** — Vale para toda sesión: una abierta hace más de 7 días vence en su
  próxima renovación, sin migrar datos.

## Qué se decidió NO hacer y por qué

- **Avisar antes de cortar**: entrar de nuevo toma segundos. Si molesta, un
  aviso va en otra spec.
- **Aplicarlo a into-credit**: el pedido es para into-sales.

## Dónde vive

`src/lib/auth/session-policy.ts` (`SESSION_MAX_DAYS`, `sessionHardLimit`) ·
`src/lib/auth/index.ts` (`databaseHooks.session.update.after`) · pruebas en
`tests/unit/session-policy.test.ts` y `tests/integration/session-limit.test.ts`.

# 1000 — Pantalla «Acerca de»

**Created**: 2026-10-15

**Status**: Especificada antes de escribir código. Implementada; gates, pruebas
contra PostgreSQL y E2E (con y sin módulos) en verde.

**Input**: pedido de Juan Carlos el 2026-10-15: «sigamos con pantalla acerca
de». Primera spec con la numeración desde 1000 (ver
[specs/README.md](../README.md)).

**Carril**: ligero (Principio VI). Comportamiento observable nuevo; no toca el
modelo de datos ni un contrato publicado.

## Problema

Hoy la versión es una línea pequeña al pie de la barra lateral. Cuando un
cliente llama a soporte («¿qué versión tienes?», «¿tienes la agenda
encendida?», «¿qué plan tienes?»), no hay una pantalla que lo diga todo junto,
y la licencia y los créditos del código base solo están en el README.

## Comportamiento observable

- **AC1** — `/about` («Acerca de») existe para cualquier persona con sesión
  (dueño, admin o vendedor). Se llega desde la versión al pie de la barra
  lateral, que pasa a ser un enlace.
- **AC2** — Muestra el nombre del producto (el de la marca, white-label), la
  versión y el commit; si el commit no salió del build, lo dice como en la
  barra (#50).
- **AC3** — Muestra qué módulos opcionales están encendidos en esta instancia,
  con las mismas banderas que `/api/health`: canales, agenda, atribución y
  servicio central.
- **AC4** — Con el servicio central encendido y una llave guardada, muestra el
  plan y el estado de la cuenta del último latido (spec 028); sin bandera no lo
  menciona.
- **AC5** — Muestra la licencia (MIT) con su texto completo desplegable y los
  créditos: IntoSales es un producto de into, sobre Vocero CRM de Kevin
  Belier.
- **AC6** — Se usa a 360 px sin scroll horizontal y no muestra secretos (ni
  llaves ni tokens: de la licencia del central, a lo más sus últimos 4).

## Qué se decidió NO hacer y por qué

- **Comprobar actualizaciones contra GitHub**: sería una llamada a un tercero
  (Principio II); la versión basta para que soporte lo compare.
- **Diagnóstico completo (doctor) en pantalla**: tiene detalle técnico que no
  es para todo el equipo; sigue en `pnpm run doctor`.

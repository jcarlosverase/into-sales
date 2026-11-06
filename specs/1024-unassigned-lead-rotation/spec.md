# 1024 — Un lead sin asignar entra al reparto cuando vuelve a escribir

**Created**: 2026-11-05

**Status**: Implementada; pruebas contra PostgreSQL y self-test en verde.

**Input**: Juan Carlos el 2026-11-05: «un lead sin asignar entra al reparto
cuando vuelve a escribir».

**Carril**: ligero. Sin datos ni contrato. Amplía la spec
[022](../022-lead-routing/spec.md).

## Problema

El reparto solo actúa cuando nace el lead. Un lead que quedó «Sin asignar»
(llegó cuando nadie recibía leads, antes del reparto, importado sin asignar o
se borró a su vendedor) se quedaba así para siempre: aunque el cliente volviera
a escribir, ningún vendedor lo veía y solo un supervisor podía rescatarlo.

## Comportamiento y criterios de aceptación

- **AC1** — Un mensaje entrante de un lead sin vendedor, en una etapa abierta,
  lo asigna al siguiente del turno, como a un lead nuevo.
- **AC2** — Un lead con vendedor no cambia de dueño ni gasta un turno.
- **AC3** — Un lead ganado o perdido sin vendedor no entra al reparto, como
  pide la D9 de la 022: no se reparten los cerrados.
- **AC4** — Con el reparto apagado o sin vendedores disponibles, sigue sin
  asignar (D5 de la 022).
- **AC5** — Dos mensajes a la vez del mismo cliente gastan un solo turno.
- **AC6** — Un fallo al asignar no tumba la ingesta del mensaje.

## Qué se decidió NO hacer y por qué

- **Repartir de golpe los leads sin asignar que ya existen**: la D9 de la 022
  sigue en pie. Cada uno entra cuando su cliente vuelve a escribir.
- **Reabrir un lead cerrado que vuelve a escribir**: es otra decisión; quien
  supervisa lo ve y decide.

## Dónde vive

`src/server/inbox/lead-activity.ts` (`onLeadActivity`) ·
`src/server/leads/routing.ts` (`onlyIfUnassigned`) · prueba en
`tests/integration/lead-returning.test.ts`.

# E2E — Reparto de leads por vendedor (022)

Arnés: `scripts/e2e-lead-routing.mjs`. Spec:
[`specs/026-reparto-de-leads/spec.md`](../../specs/026-reparto-de-leads/spec.md).
Contrato:
[`specs/026-reparto-de-leads/contracts/api.md`](../../specs/026-reparto-de-leads/contracts/api.md).

Precondición: app corriendo sobre una base **vacía** y migrada (el registro se
cierra tras la primera organización), con `ALLOW_SIGNUP=true`. No hace falta
WhatsApp: los leads entran por la captura manual, que usa la misma puerta que
el webhook (`createLeadForContact`).

```bash
BASE_URL=http://localhost:3000 node scripts/e2e-lead-routing.mjs
```

## Setup

1. Registro del propietario.
2. Dos cuentas de equipo, Ana y Beto, en ese orden (Ajustes → Equipo).
3. `GET /api/settings/lead-routing` → reparto encendido, Ana y Beto en orden.

## Historia 1 — Reparto por turno (AC1)

El propietario captura tres prospectos: quedan con Ana, Beto y Ana.

## Historia 2 — El vendedor solo ve lo suyo (AC6, AC7)

Ana inicia sesión:

- El Pipeline y Contactos muestran sus 2 leads.
- El contacto, el lead y la edición de lo de Beto responden 404.
- El tablero le dice que no puede asignar y no trae la lista del equipo.

## Historia 3 — Solo el supervisor reasigna (AC10–AC13)

- Ana reasignando un lead → 403. Ana cambiando el reparto → 403.
- El propietario pasa un lead de Ana a Beto: Ana deja de verlo.
- Asignar a alguien fuera del equipo → 422.
- El propietario deja un lead sin asignar.

## Historia 4 — Vendedor fuera del turno (AC2)

El propietario apaga «Recibe leads nuevos» de Beto: los dos leads siguientes
van a Ana y Beto conserva el suyo.

## Historia 5 — Reparto apagado (AC3, AC9)

Con el reparto apagado, el lead nuevo queda sin asignar: el propietario lo ve,
Ana no.

## Historia 6 — Captura del vendedor (AC5)

Ana captura un prospecto: queda asignado a ella.

## A mano (no lo cubre el arnés)

- **Bandeja y tiempo real (AC6, AC8)**: con WhatsApp de pruebas, dos
  conversaciones nuevas caen una a cada vendedor; cada uno ve solo la suya en
  la Bandeja, y un mensaje nuevo en la de Beto no aparece en la pantalla de
  Ana.
- **Tarjetas (AC14)**: el Pipeline muestra las iniciales del vendedor, o «?»
  con «Sin asignar» al pasar el puntero.
- **Ajustes (AC13)**: Ajustes → Equipo muestra «Reparto de leads»; el
  vendedor la ve sin poder cambiarla.

## Bandeja, tiempo real y Citas (automatizado el 2026-10-15)

`scripts/e2e-lead-routing.mjs` contra una base vacía y la app con los mocks
(`WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock):

1. Un WhatsApp nuevo (wa-mock) entra al vendedor que le toca por turno (AC4).
2. Ese vendedor lo ve en la Bandeja y lo recibe en vivo por SSE; el otro no lo
   ve, no lo recibe y al tocarlo o leer sus mensajes recibe 404 (AC6–AC8).
3. Con `AGENDA=on` en la app y en el guion: el dueño agenda una cita para un
   contacto de cada vendedor; cada vendedor ve solo la suya (y los bloqueos),
   el dueño ve las dos; un vendedor no puede cancelar ni agendar sobre un
   contacto ajeno (404) y sí sobre el suyo (AC15, AC16).

La higiene de Resultados por vendedor (AC17) se prueba contra PostgreSQL en
`tests/integration/lead-scope-bookings.test.ts`.


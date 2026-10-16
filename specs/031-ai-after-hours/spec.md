# 031 — La IA responde solo fuera de horario

**Created**: 2026-10-15

**Status**: Especificada antes de escribir código. Implementada; gates, pruebas
contra PostgreSQL y E2E (con una corrida del Laboratorio) en verde.

**Input**: plan de la semana 2 de IntoSales, pedido de Juan Carlos: «IA:
responder solo fuera de horario (opción configurable)». La spec 022 la dejó
fuera a propósito.

**Carril**: ciclo completo (Principio VI). Añade tres columnas a
`agent_profile` (migración aditiva `0022`) y cambia el contrato interno de
`/api/agent/profile`. Plan en [plan.md](plan.md), tareas en [tasks.md](tasks.md).

## Problema

Muchos negocios quieren que su equipo atienda en persona durante el día y que
el agente cubra la noche, el fin de semana y los feriados, para que ningún
mensaje quede sin respuesta hasta el día siguiente. Hoy el agente está
encendido o apagado a toda hora: o le quita los chats al equipo, o deja sin
respuesta a quien escribe a las once de la noche.

## Historias

**H1 — El dueño elige cuándo contesta la IA.** En Agente, «Cuándo responde»:
«Siempre» (como hoy) o «Solo fuera del horario de atención».

**H2 — Define su horario de atención.** Por día de la semana, desde y hasta,
en la zona horaria del negocio. Un día sin horario es un día sin atención
humana (la IA contesta todo el día).

**H3 — Sabe qué pasa ahora mismo.** La pantalla dice si en este momento es
horario de atención (contesta el equipo) o no (contesta la IA).

## Decisiones

**D1 — Es un modo del agente**, no otro interruptor: `reply_mode` =
`always` (por defecto, el comportamiento de hoy) u `outside_hours`. El
interruptor de encendido sigue mandando: apagado, la IA no contesta nunca.

**D2 — El horario de atención es propio**, separado del de la agenda (015):
la agenda dice cuándo se pueden agendar citas; la atención, cuándo hay alguien
del equipo en la Bandeja. Tiene la misma forma (por día, tramos desde–hasta en
hora de pared) y su propia zona horaria. Por defecto: lunes a viernes de 09:00
a 18:00, en la zona del negocio (la de la agenda, o la de por defecto:
`America/Lima` desde el 2026-10-15).

**D3 — Se decide cuando la IA va a contestar**, no cuando llega el mensaje (el
agente espera unos segundos a que el cliente termine de escribir). Dentro del
horario la IA calla y la conversación queda en la Bandeja para el equipo, sin
marcarla como traspasada. Fuera del horario contesta como siempre. Al cerrar
el horario no contesta lo que llegó antes: eso es del equipo.

**D4 — El Laboratorio ignora el horario**: prueba el agente a cualquier hora.

**D5 — No cambia al cerebro externo (021).** Con el despacho activo el agente
incluido ya está callado y el cerebro decide cuándo contestar; esta opción es
del agente incluido.

## Criterios de aceptación

- **AC1** — `PUT /api/agent/profile` acepta `replyMode` (`always` o
  `outside_hours`), `attentionHours` (días `mon`…`sun`, tramos `HH:MM` con
  inicio antes que fin) y `attentionTimezone` (una zona IANA). Algo inválido
  responde 422. `GET` los devuelve con los valores por defecto y con
  `attentionNow` (si ahora es horario de atención).
- **AC2** — Con `outside_hours`, un mensaje real dentro del horario no recibe
  respuesta de la IA y la conversación no queda traspasada; fuera del horario
  la recibe.
- **AC3** — Con `always` (o sin configurar) todo sigue como hoy.
- **AC4** — En el Laboratorio la IA contesta a cualquier hora.
- **AC5** — En Agente se elige el modo, se edita el horario y se ve si ahora es
  horario de atención; a 360 px sin scroll horizontal.

## Qué se decidió NO hacer y por qué

- **Feriados y excepciones por fecha**: otro modelo (fechas sueltas); se puede
  agregar después. Hoy un feriado se cubre quitando ese día a mano.
- **Un mensaje automático de «estamos fuera de horario»**: la IA ya contesta
  fuera de horario; un aviso fijo sería otra función.
- **Que la IA conteste dentro del horario si nadie del equipo responde en X
  minutos**: útil, pero es una regla de traspaso aparte.
- **Aplicarlo al cerebro externo**: D5.

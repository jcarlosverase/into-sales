# 1010 — Guardar Messenger suscribe la página a la app

**Created**: 2026-10-27

**Status**: Implementada; pruebas unitarias y typecheck en verde.

**Input**: reporte de Juan Carlos el 2026-10-27: «no me llegan los mensajes de
Messenger a into-sales».

**Carril**: ligero. Una llamada a Meta al guardar y su aviso; sin migración.

## Causa

En el modo «app propia de Meta», Meta solo entrega los mensajes de una página
al webhook de la app si la página está **suscrita** a esa app
(`POST /{page-id}/subscribed_apps`). Configurar el webhook de la app (objeto
`page`, campo `messages`) no basta. El CRM guardaba el token y dejaba la
suscripción al dueño en una línea de ayuda («suscribe la página a la app»), sin
decir cómo; si no la hacía, la pantalla mostraba «Messenger activo» y no
llegaba ningún mensaje.

## Comportamiento observable y criterios de aceptación

- **AC1** — Al pulsar «Probar y guardar» en modo Meta, después de validar y
  guardar el token, el CRM suscribe la página a la app del token con el campo
  `messages`.
- **AC2** — Si Meta no acepta la suscripción, la conexión queda guardada (el
  token es válido y puede enviar) y la pantalla dice que no llegarán mensajes y
  por qué: sin `pages_manage_metadata`, token vencido, Meta caída u otro motivo
  de Meta. Volver a guardar reintenta.
- **AC3** — La ayuda pide el token con `pages_messaging` y
  `pages_manage_metadata`, y la tarjeta del webhook ya no pide suscribir la
  página a mano.
- **AC4** — El modo Zernio no cambia: ahí el webhook lo da de alta el CRM en
  Zernio (spec 023).

## Qué se decidió NO hacer y por qué

- **No se configura el webhook de la app por API**: hace falta un token de app
  (App ID + App Secret) que el CRM no tiene; se sigue pegando la URL una vez en
  el panel de Meta, como hoy.
- **No hay botón aparte de «reintentar»**: «Probar y guardar» ya lo hace.

## Dónde vive

`src/server/messenger/subscribe.ts` · `src/app/api/settings/messenger/route.ts`
· `src/components/settings/messenger-client.tsx` · prueba en
`tests/unit/messenger-subscribe.test.ts`.

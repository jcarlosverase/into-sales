# 1008 — Guardar la conexión de WhatsApp registra el webhook aunque otra app tenga override

**Created**: 2026-10-25

**Status**: Implementada; pruebas unitarias del registro y typecheck en verde.

**Input**: reporte de Juan Carlos el 2026-10-25: en Ajustes → WhatsApp, al
guardar la conexión no se actualiza ni se registra el webhook en Meta.

**Carril**: ligero. Corrige `registerWebhookForNumber`; sin migración.

## Causa

Antes de registrar el override del número, el CRM consulta
`GET /{waba}/subscribed_apps` para no pisar el override de un cerebro externo
(Nea) o de una agencia. Esa consulta devuelve **todas** las apps suscritas a la
WABA, y el CRM tomaba el override de cualquiera de ellas. Pero en Meta los
overrides son **por app**: el de otra app (un proveedor anterior, Zernio, la
plataforma de una agencia) solo redirige lo que recibe esa app y no compite con
el nuestro. Con una segunda app con override en la WABA, «Guardar» respondía
«tu cuenta ya enruta sus webhooks a…», no registraba nada y además quitaba el
webhook del número que hubiera puesto un guardado anterior.

## Comportamiento observable y criterios de aceptación

- **AC1** — Al guardar, el CRM pregunta a Meta de qué app es el token
  (`GET /app`) y solo respeta el override de la WABA si es de **esa** app.
- **AC2** — Si el override es de otra app, el CRM suscribe su app, registra el
  webhook en el número y la pantalla dice «Webhook registrado en Meta».
- **AC3** — Si el override es de nuestra app y apunta a otro lado (Nea), se
  respeta como antes; si apunta a esta instancia, se registra el número sin
  re-suscribir.
- **AC4** — Si Meta no dice de qué app es el token, se mantiene el criterio de
  antes (se respeta cualquier override) y se deja un aviso en el registro, sin
  el token.
- **AC5** — «Registrar en Meta» (la tarjeta del webhook) sigue el mismo camino.

## Dónde vive

`src/server/whatsapp/connect.ts` (`tokenAppId`, `wabaOverride`) · mock en
`src/app/api/dev/wa-mock/graph/[...path]/route.ts` (`GET /app`) · pruebas en
`tests/unit/subscribed-apps.test.ts` y `tests/unit/webhook-registration.test.ts`.

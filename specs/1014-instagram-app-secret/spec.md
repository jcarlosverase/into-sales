# 1014 — Instagram acepta la firma con la clave de la app de Instagram

**Created**: 2026-10-29

**Status**: Implementada; pruebas unitarias, typecheck y lint en verde.

**Input**: Juan Carlos el 2026-10-29: con Instagram conectado por app propia,
la cuenta suscrita, el webhook verificado con `messages` y la app publicada,
«no llegan los mensajes».

**Carril**: ligero. Validación de la firma del webhook y registro; sin
migración.

## Causa probable

Al agregar el caso de uso de Instagram con inicio de sesión de Instagram, Meta
crea una identidad de la app para Instagram («IntoSales - IG») con su propio
ID y su propia **clave secreta**, distinta del App Secret de la app de Meta.
La documentación de Meta no deja claro con cuál firma los webhooks de
Instagram, y hay reportes de que usa la de Instagram. El CRM validaba solo con
`META_APP_SECRET`: si Meta firmaba con la otra, cada mensaje se rechazaba con
401 **sin dejar nada en el log** (a diferencia de WhatsApp), así que no había
forma de verlo.

## Comportamiento observable y criterios de aceptación

- **AC1** — Variable opcional `INSTAGRAM_APP_SECRET`. El webhook de Instagram
  (fuente Meta) acepta la firma hecha con `META_APP_SECRET` **o** con
  `INSTAGRAM_APP_SECRET`. Sin ninguna de las dos, no se valida (como hoy).
- **AC2** — Un rechazo por firma en Instagram y en Messenger deja un aviso en
  el log (como ya hacía WhatsApp), a lo más uno por minuto, sin el secreto. El
  de Instagram dice dónde está la clave de la app de Instagram.
- **AC3** — `INSTAGRAM_APP_SECRET` se pasa al contenedor (`docker-compose.yml`),
  se documenta en `.env.example` y en `docs/vps-installer.md`, se fija con
  `--env INSTAGRAM_APP_SECRET=…` y `pnpm doctor` nunca imprime su valor.
- **AC4** — WhatsApp, Messenger y Zernio no cambian de secreto.

## Dónde vive

`src/lib/env.ts` · `src/server/inbox/webhook.ts` (`isValidSignatureWithAny`,
`warnInvalidSignature`) · `src/app/api/webhooks/ig/[webhookToken]/route.ts` ·
`src/app/api/webhooks/messenger/[webhookToken]/route.ts` ·
`src/server/doctor/checks.ts` · `docker-compose.yml` · `.env.example` ·
`docs/vps-installer.md` · prueba en `tests/unit/instagram-signature.test.ts`.

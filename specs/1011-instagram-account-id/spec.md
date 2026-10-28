# 1011 — Instagram (modo Meta) guarda el ID de cuenta correcto

**Created**: 2026-10-27

**Status**: Implementada; pruebas unitarias y typecheck en verde.

**Input**: pregunta de Juan Carlos el 2026-10-27: «¿dónde consigo los datos
"ID de la cuenta de Instagram" y "Token de acceso"?». Al revisar la pantalla
apareció el error de abajo.

**Carril**: ligero. Validación del guardado y la pantalla; sin migración.

## Causa

Con la API de Instagram con inicio de sesión de Instagram, `GET /me` devuelve
dos IDs: `id`, el de la persona dentro de la app (app-scoped), y `user_id`, el
de la cuenta profesional (IG_ID). El IG_ID es el que llega en `entry[].id` de
cada webhook (así se enruta la entrega) y con el que se envía
(`/{IG_ID}/messages`). El CRM pedía `id` y exigía que coincidiera con el ID
pegado:

- quien pegaba el IG_ID que muestra el panel de Meta recibía «El IG_ID del
  token es …» y no podía guardar;
- quien pegaba el número que sugería el error quedaba «conectado» con el ID
  app-scoped, y ningún webhook encontraba su cuenta: no llegaban mensajes.

## Comportamiento observable y criterios de aceptación

- **AC1** — El CRM pide `/me?fields=user_id,username` y guarda `user_id`
  (IG_ID). Si Meta no manda `user_id`, usa `id`.
- **AC2** — El campo «ID de la cuenta de Instagram» es opcional: con solo el
  token basta.
- **AC3** — Si se pega un ID, se acepta el IG_ID o el app-scoped de esa misma
  cuenta (se guarda el IG_ID); uno de otra cuenta se rechaza con 422.
- **AC4** — La ayuda dice dónde generar el token (Instagram → Configuración de
  la API con inicio de sesión de Instagram → «Generar token»).
- **AC5** — Una conexión guardada antes con el ID app-scoped se corrige
  volviendo a pulsar guardar con un token.

## Dónde vive

`src/app/api/settings/instagram/route.ts` (`verify`) ·
`src/components/settings/instagram-client.tsx` · prueba en
`tests/unit/instagram-save-meta.test.ts`.

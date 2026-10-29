# 1016 — Messenger acepta el token de página sin permiso de lectura

**Created**: 2026-10-29

**Status**: Implementada; pruebas unitarias, typecheck y lint en verde.

**Input**: Juan Carlos el 2026-10-29, con la versión de la spec 1012
desplegada: «Probar y guardar» responde «El token de la página no es válido.
Meta dice: (#100) … This endpoint requires the 'pages_read_engagement'
permission or the 'Page Public Content Access' feature…».

**Carril**: ligero. Corrige la validación de la spec 1012; sin migración.

## Causa

La spec 1012 validaba el token con `GET /me?fields=id`, suponiendo que leer
el id de la propia página no pedía permisos de lectura. En esta página Meta sí
exige `pages_read_engagement` (o una función de acceso público) hasta para
eso, y el token que genera el caso de uso de Messenger no lo trae. El CRM lo
tomaba como token inválido.

## Comportamiento observable y criterios de aceptación

- **AC1** — Si `/me` falla por falta de permiso de lectura (código 100, 10 o
  200 que pide `pages_read_engagement` o acceso público), no se rechaza el
  token: la suscripción de la página a la app (spec 1010) pasa a ser la
  prueba, y se hace ANTES de guardar.
- **AC2** — Si esa suscripción funciona, la conexión se guarda (sin nombre de
  página si Meta no lo deja leer) y no se suscribe dos veces.
- **AC3** — Si la suscripción tampoco funciona, no se guarda nada y el aviso
  dice el motivo (por ejemplo, falta `pages_manage_metadata`).
- **AC4** — Un token vencido o inválido (190 / 401) se sigue rechazando como
  antes, con el motivo de Meta. Con permiso de lectura, todo sigue como en la
  spec 1012 (incluido el rechazo de un token de otra página).

## Dónde vive

`src/app/api/settings/messenger/route.ts` (`verify`,
`isMissingReadPermission`) · prueba en `tests/unit/messenger-save-meta.test.ts`.

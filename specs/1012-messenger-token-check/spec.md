# 1012 — Messenger (modo Meta) valida el token de la página con `/me`

**Created**: 2026-10-29

**Status**: Implementada; pruebas unitarias y typecheck en verde.

**Input**: reporte de Juan Carlos el 2026-10-29: con el ID de la página y un
token recién generado en «Configuración de la API de Messenger», IntoSales
responde «El token de la página no es válido o no tiene permiso de mensajes
(pages_messaging)».

**Carril**: ligero. La validación del guardado; sin migración.

## Causa

Para validar, el CRM pedía `GET /{page-id}?fields=id,name`. Leer el `name` de
la página exige `pages_read_engagement`, y el token que genera el caso de uso
de Messenger no siempre lo trae: Meta respondía con un error de permisos y el
CRM lo mostraba como token no válido. Además esa consulta devuelve siempre el
ID pedido, así que no comprobaba de quién era el token. Y el aviso escondía el
motivo real de Meta.

## Comportamiento observable y criterios de aceptación

- **AC1** — El token se valida con `GET /me?fields=id`: con un token de página,
  `/me` es la página, y su ID tiene que ser el pegado. Un token de usuario o de
  otra página se rechaza con 422 diciendo de quién es.
- **AC2** — El nombre de la página se pide aparte (`/me?fields=name`); si Meta
  no lo da, se guarda la conexión sin nombre.
- **AC3** — Si Meta rechaza el token, el aviso agrega su motivo
  («Meta dice: …»), que nunca incluye el token.
- **AC4** — Después se suscribe la página como en la spec 1010.

## Dónde vive

`src/app/api/settings/messenger/route.ts` (`verify`, `translate`) · mock
`GET /me` en `src/app/api/dev/wa-mock/graph/[...path]/route.ts` · prueba en
`tests/unit/messenger-save-meta.test.ts`.

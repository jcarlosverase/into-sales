# 1015 — El nombre de quien escribe por Instagram

**Created**: 2026-10-29

**Status**: Implementada; pruebas unitarias, typecheck y lint en verde. La
actualización del contacto en la base la cubre el E2E (no la corrí).

**Input**: Juan Carlos el 2026-10-29: «ya me llegó el mensaje de Instagram,
pero no me sale el nombre, solo dice "Contacto de Instagram"».

**Carril**: ligero. Una consulta al perfil en la ingesta; sin migración.

## Causa

El webhook de Instagram de Meta solo trae el IGSID de quien escribe. Messenger
ya consultaba el perfil la primera vez que veía a alguien, pero Instagram no:
todo contacto nuevo quedaba como «Contacto de Instagram». Además, en los
canales sociales el nombre se fijaba solo al crear el contacto, así que uno
que ya quedó con el respaldo no se corregía nunca.

## Comportamiento observable y criterios de aceptación

- **AC1** — Al llegar un DM de Instagram (app propia de Meta), si el contacto
  no existe o sigue con el nombre de respaldo, el CRM consulta
  `GET graph.instagram.com/{IGSID}?fields=name,username` con el token de la
  cuenta y usa `name`; si no hay, `@username`. Si Meta no responde, el mensaje
  entra igual con el respaldo.
- **AC2** — Un contacto de Instagram o Messenger que tiene el nombre de
  respaldo («Contacto de Instagram», «Contacto de Messenger») y nadie renombró
  (`name_source = perfil`) toma el nombre del perfil con su siguiente mensaje.
  Uno con nombre propio o renombrado por una persona no se toca.
- **AC3** — Messenger usa la misma regla (antes solo consultaba si el contacto
  no existía). Zernio no cambia: su evento ya trae el nombre.
- **AC4** — El perfil no se consulta en cada mensaje: solo mientras falte el
  nombre.

## Dónde vive

`src/server/instagram/send.ts` (`fetchInstagramProfileName`) ·
`src/server/instagram/ingest.ts` · `src/server/inbox/identity.ts`
(`socialContactNeedsName` y la actualización del nombre de respaldo) ·
`src/server/messenger/ingest.ts` · prueba en
`tests/unit/instagram-profile-name.test.ts`.

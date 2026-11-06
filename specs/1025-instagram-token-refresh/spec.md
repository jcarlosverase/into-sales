# 1025 — Renovación automática del token de Instagram

**Created**: 2026-11-05

**Status**: Implementada; pruebas contra PostgreSQL en verde. La llamada real a
Instagram solo se ejercita con su API simulada: falta verla en una cuenta real.

**Input**: Juan Carlos el 2026-11-05: «renovación automática del token de
Instagram antes de los 60 días».

**Carril**: ligero, con una migración aditiva (`0030`: dos columnas). Amplía la
spec [1017](../1017-instagram-login-button/spec.md).

## Problema

«Conectar con Instagram» deja un token de larga duración que vence a los 60
días. Nada lo renovaba: al vencer, los envíos se pausaban y el negocio tenía que
volver a conectar a mano.

## Comportamiento y criterios de aceptación

- **AC1** — Al conectar se guarda cuándo vence el token (`expires_in`).
- **AC2** — Al arrancar y cada 6 horas, con el canal encendido, se renueva con
  `GET /refresh_access_token` (`ig_refresh_token`) todo token de la app de Meta
  a 20 días o menos de vencer, y guarda el nuevo cifrado con su nuevo vencimiento.
- **AC3** — Un token con vencimiento desconocido (conectado antes de esta spec
  o pegado a mano) también se intenta: si funciona, ya se sabe cuándo vence.
- **AC4** — Un fallo pasajero no cambia nada y se reintenta en la siguiente
  vuelta: hay 20 días de margen.
- **AC5** — Un token de vencimiento conocido que Instagram da por inválido
  (código 190) pasa a `reconnect_required`, y la pantalla pide reconectar. Uno
  pegado a mano nunca se marca por esto: puede no ser renovable y seguir
  sirviendo para enviar.
- **AC6** — Las conexiones por Zernio no se tocan.
- **AC7** — Ajustes → Instagram dice que el token se renueva solo y cuándo
  vence. Ningún token sale en el log ni en la API.

## Qué se decidió NO hacer y por qué

- **Avisar por correo o WhatsApp que falló la renovación**: si muere, la
  pantalla ya pide reconectar y Salud lo marca.
- **Renovar el token de Messenger**: los tokens de página no vencen así.

## Dónde vive

`src/server/instagram/token-refresh.ts` · `oauth.ts`
(`refreshLongLivedToken`) · `credentials.ts` · `src/instrumentation*.ts` ·
`src/components/settings/instagram-client.tsx` ·
`drizzle/0030_instagram_token_expiry.sql` · prueba en
`tests/integration/instagram-token-refresh.test.ts`.

# 1017 — «Conectar con Instagram» en Ajustes → Instagram

**Created**: 2026-10-31

**Status**: Especificada antes de escribir código. Implementada; pruebas
unitarias, typecheck y lint en verde. Pendiente: probarla contra Meta real
(necesita desplegar y registrar la URL de vuelta en la app de Meta).

**Input**: pedido de Juan Carlos el 2026-10-31: «implementa "Conectar con
Instagram" en Ajustes → Instagram, para que los revisores de Meta conecten su
propia cuenta».

**Carril**: ligero. Un flujo OAuth con dos rutas, una variable nueva y la
pantalla; sin migración (la conexión se guarda en `instagram_credentials`
como hoy).

## Problema

Para aprobar `instagram_business_basic` e `instagram_business_manage_messages`,
Meta pide ver en video que un negocio conecta SU cuenta desde la app, con el
inicio de sesión de Instagram, y que la app muestra la cuenta conectada. Hoy
la única forma es pegar un token generado en el panel de desarrolladores, que
un revisor (o un cliente) no puede hacer.

## Comportamiento observable y criterios de aceptación

- **AC1** — Con `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET` configurados, en
  Ajustes → Instagram → «App propia de Meta» aparece el botón «Conectar con
  Instagram». Solo el propietario de la organización puede usarlo. Sin esas
  variables el botón no aparece y la pantalla dice qué falta.
- **AC2** — El botón abre el inicio de sesión de Instagram
  (`www.instagram.com/oauth/authorize`) con los permisos
  `instagram_business_basic` e `instagram_business_manage_messages`, la URL
  de vuelta `APP_BASE_URL/api/settings/instagram/oauth/callback` y un `state`
  aleatorio guardado en una cookie httpOnly de 10 minutos.
- **AC3** — Al volver, el CRM comprueba el `state`, cambia el código por un
  token corto (`api.instagram.com/oauth/access_token`) y este por uno de
  larga duración (`graph.instagram.com/access_token`, 60 días), lee la cuenta
  (`/me?fields=user_id,username`) y guarda la conexión cifrada como hoy, con
  el IG_ID de la cuenta (spec 1011).
- **AC4** — Después suscribe la cuenta al webhook de la app
  (`POST /me/subscribed_apps`, campo `messages`), lo que en el panel de Meta
  es el interruptor «Suscripción a webhook». Si falla, la conexión queda
  guardada y la pantalla lo avisa.
- **AC5** — De vuelta en Ajustes → Instagram, la tarjeta de conexión muestra
  la foto de perfil y el @usuario de la cuenta conectada.
- **AC6** — Si la persona cancela, el `state` no coincide o Meta rechaza el
  código, no se guarda nada y la pantalla dice qué pasó en palabras. Ni el
  código ni los tokens aparecen en la URL final, en el log ni en la respuesta.
- **AC7** — Pegar el token a mano sigue funcionando como alternativa.
- **AC8** — La pantalla muestra la URL de vuelta para registrarla en Meta
  (Casos de uso → Instagram → Configuración de la API con inicio de sesión de
  Instagram → paso 4, «Configura un inicio de sesión empresarial de
  Instagram»).

## Qué se decidió NO hacer y por qué

- **Renovar el token de 60 días automáticamente**: va en su propia spec; hoy,
  cuando vence, la conexión pasa a «reconectar» y basta pulsar el botón.
- **Guardar la foto de perfil**: la URL de Instagram caduca; se pide en vivo
  al abrir la pantalla y, si no llega, se muestra solo el @usuario.

## Dónde vive

`src/server/instagram/oauth.ts` · `src/app/api/settings/instagram/oauth/start/route.ts`
· `src/app/api/settings/instagram/oauth/callback/route.ts` ·
`src/app/api/settings/instagram/route.ts` (estado del botón y foto) ·
`src/components/settings/instagram-client.tsx` · `src/lib/env.ts`
(`INSTAGRAM_APP_ID`) · `.env.example` · `docs/vps-installer.md` · prueba en
`tests/unit/instagram-oauth.test.ts`.

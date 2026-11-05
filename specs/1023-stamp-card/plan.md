# Plan — 1023 Tarjeta de sellos virtual

Spec: [spec.md](spec.md) · Datos: [data-model.md](data-model.md) · Tareas:
[tasks.md](tasks.md) · Contrato del central: into-central
`specs/016-wallet-passes/contracts/api.md` · Configuración:
[quickstart.md](quickstart.md).

## Orden

Se entrega en tres cortes, y cada uno deja el CRM en verde:

1. **Tarjeta web** (sin terceros): bandera, datos, programa, alta por
   WhatsApp, página pública, sellar y canjear. Ya sirve sin wallet (D9).
2. **Apple Wallet**: armar el `.pkpass`, la firma por el central, el servicio
   web y los avisos por APNs.
3. **Google Wallet, Resultados y agente**: clase, enlace y actualización por
   el central, la sección de Resultados y el contexto del agente (P2 y P3).

## Datos

Migración aditiva `0027_stamp_card` con las cuatro tablas de
[data-model.md](data-model.md). Se aplica siempre, como la de la agenda.

## Piezas

| Pieza | Dónde |
|---|---|
| Bandera | `src/server/stamp-card/flag.ts`: `stampCardEnabled()` y `stampCardDisabledResponse()` (404), igual que `src/server/agenda/flag.ts`. `STAMP_CARD` documentada en `src/lib/env.ts` y `.env.example` |
| Reglas (puras) | `src/lib/stamp-card.ts`: esquema Zod del programa, `normalizePhrase()` (minúsculas, sin tildes ni signos), `canStamp(lastStampAt, minHours, now)`, `applyStamp()` y `applyRedeem()` (sobrante al siguiente ciclo), `renderJoinReply()` con `{nombre}`, `{negocio}` y `{enlace}` |
| Dominio | `src/server/stamp-card/`: `program.ts` (leer y guardar), `cards.ts` (crear o reutilizar por contacto, token público y serial, sellar, canjear, ajustar, en transacción y con `idempotency_key`), `join.ts` (la frase de alta) |
| Frase de alta (D4) | `src/server/inbox/ingest.ts`: antes de `maybeRunAgentTurn`, si la bandera está encendida, el canal es WhatsApp y `matchesJoinPhrase()`, se llama a `handleJoin()`, que responde con `sendText()` (ventana abierta: el cliente acaba de escribir) y **no** dispara el turno ni el despacho al cerebro |
| API del panel | `src/app/api/stamp-card/program/route.ts` (GET/PUT, PUT solo administrador) · `src/app/api/stamp-card/cards/route.ts` (POST: crear desde la ficha) · `src/app/api/stamp-card/cards/[id]/route.ts` (GET con bitácora) · `.../[id]/stamp`, `.../[id]/redeem` y `.../[id]/adjust` (POST con `Idempotency-Key`; `adjust` solo administrador) |
| Página pública | grupo de rutas nuevo `src/app/(public)/c/[token]/page.tsx`, sin sesión, `robots: noindex`, con límite por IP (`src/server/security/`). Muestra la tarjeta con el sistema de diseño y los botones de wallet según `walletAvailability()` |
| QR del equipo (D6) | `src/app/(app)/s/[serial]/page.tsx`: dentro de `(app)`, así hereda la sesión obligatoria y sin sesión va a «Entrar». Muestra la tarjeta grande con «+ Sumar sello» y «Canjear premio» |
| Imágenes | `src/server/stamp-card/images.ts`: `icon`, `logo` y `strip` (círculos de sellos) en PNG @1x/@2x/@3x con `next/og` (como `src/app/api/branding/app-icon/route.tsx`) · QR en SVG con un generador propio o la dependencia `qrcode` (se decide en T004, preferido sin dependencia) |
| Cartel del mostrador | `src/app/api/stamp-card/poster/route.ts`: PNG con el QR de `https://wa.me/<número>?text=<frase>`, el logo y la frase. Se imprime como PDF desde el navegador (sin dependencia de PDF) |
| Pantalla del dueño | `src/app/(app)/settings/stamp-card/page.tsx` + `src/components/settings/stamp-card-form.tsx`: formulario, vista previa, cartel y enlace NFC. Entrada en el menú de Ajustes solo con la bandera |
| Tarjeta en la ficha | `src/components/stamp-card/card-panel.tsx` en `src/components/pipeline/lead-drawer.tsx` y en `src/components/qualification-panel.tsx` (Bandeja) |
| Cliente del central | `src/server/central/wallet.ts`: `getWalletConfig()` (en caché 10 min), `signAppleManifest()`, `pushApple()`, `putGoogleClass()`, `googleSaveLink()`, `patchGoogleObject()` sobre el adaptador `client.ts` y la llave de `license.ts`. Errores tipados (`plan_without_wallet`, `wallet_unavailable`…) |
| Pase de Apple | `src/server/stamp-card/apple-pass.ts`: `pass.json` (`storeCard`, `webServiceURL = <APP_URL>/api/wallet/apple`, `authenticationToken`, código QR con `/s/<serial>`), manifiesto SHA-1, firma del central y zip. El zip se arma con una implementación mínima de «store» (sin compresión), sin dependencia |
| Servicio web de Apple (AC9) | `src/app/api/wallet/apple/v1/devices/[device]/registrations/[passType]/[serial]/route.ts` (POST/DELETE) · `.../registrations/[passType]/route.ts` (GET `passesUpdatedSince`) · `src/app/api/wallet/apple/v1/passes/[passType]/[serial]/route.ts` (GET, con `Last-Modified`) · `src/app/api/wallet/apple/v1/log/route.ts` (POST, al logger sin datos) |
| Google | `src/server/stamp-card/google-pass.ts`: clase desde el programa (sube `version` al editarlo) y objeto desde la tarjeta (sin nombre ni teléfono) |
| Sincronización (D9) | `src/server/stamp-card/wallet-sync.ts`: tras sellar, canjear o editar, marca `wallet_sync_pending` y lo intenta en segundo plano. Un temporizador en proceso (como el latido, 60 s) reintenta los pendientes con espera creciente |
| Resultados (H6) | `src/server/analytics/stamp-card.ts` + `src/components/results/stamp-card-section.tsx`, con el periodo de `period.ts` y la exclusión del Laboratorio de `shared.ts` |
| Agente (H7) | `src/server/ai/prompts.ts`: con la bandera y una tarjeta del contacto, una línea de contexto con sellos, premio y enlace. Sin acción nueva: el agente solo informa |
| Salud y doctor | `src/server/doctor/checks.ts`: chequeo `stamp_card` (`skip` sin bandera; `warn` si hay pendientes de wallet de más de una hora) |

## Pruebas

- **Unitarias**: esquema del programa, `normalizePhrase` (mayúsculas,
  tildes, signos y espacios), `canStamp` en el borde, canje con sobrante,
  plantilla de respuesta, `pass.json` y manifiesto, zip «store» legible por
  `unzip`, objeto de Google sin campos personales.
- **Integración (PostgreSQL)**: crear o reutilizar la tarjeta (único por
  contacto), sello idempotente, canje con 409, ajuste solo administrador,
  servicio web de Apple (registro, baja, `passesUpdatedSince`, token
  inválido 401), sincronización pendiente y reintento.
- **Mock del central**: `src/app/api/dev/central-mock/wallet/*` tras
  `dev-guard`, con camino infeliz (503, 403 `plan_without_wallet`). Una
  prueba revisa que ningún cuerpo enviado lleve nombre ni teléfono (AC11).
- **E2E** (`scripts/e2e-stamp-card.mjs` y `tests/e2e/us-stamp-card.md`): con
  la bandera apagada, todo da 404 (AC1). Encendida: guardar el programa,
  enviar la frase con el wa-mock y recibir el enlace sin turno de IA, abrir
  `/c/<token>` a 360 px, sellar dos veces (la segunda pide confirmación),
  completar, canjear, `/s/<serial>` sin sesión va a «Entrar», descargar el
  `.pkpass` contra el mock y verificar su estructura.
- **Verificación humana** (Principio IX, pendiente al cerrar): abrir el
  `.pkpass` en un iPhone real y guardar en Google Wallet con una cuenta de
  prueba, contra el central de desarrollo con las credenciales reales.

## Decisiones al implementar el corte 1 (2026-11-05)

- **QR propio** (`src/lib/qr.ts`, T004): modo byte, nivel M, versiones 1 a
  20, sin dependencia. Se leyó con zxing-cpp de 1 a 666 bytes, y la prueba
  unitaria fija tres matrices verificadas.
- **Tokens derivados** en vez de aleatorios guardados (ver data-model): la
  frase repetida reenvía el mismo enlace.
- **`/s/<serial>` vive en su propio grupo `(staff)`**, no dentro de `(app)`:
  el layout de `(app)` manda a «Entrar» antes de que la página pueda
  responder 404 con la bandera apagada (AC1). La página revisa la bandera y
  la sesión, y «Entrar» vuelve a la tarjeta con `?next=` (solo rutas propias).
- **Cartel**: PNG con `next/og` (`/api/stamp-card/poster`) y una página para
  imprimir o guardar en PDF (`/stamp-card/poster`), sin dependencia de PDF.
- **Quién sella**: cualquiera del equipo con sesión, por el id de la tarjeta
  (D6). Buscar o crear la tarjeta de un contacto respeta el alcance de leads
  de la 022.
- **La frase de alta** solo cuenta si el mensaje ES la frase (normalizada),
  no si la contiene: «hola, quiero mi tarjeta de sellos por favor» va al
  agente.

## Riesgos

- **APNs y Google reales** no se pueden probar en el CI. Por eso existen el
  mock y la verificación humana.
- **El dominio del CRM** debe ser HTTPS público para el servicio web de
  Apple. En desarrollo, el pase se genera sin `webServiceURL` y no se
  actualiza solo.
- **El webhook de WhatsApp** debe seguir respondiendo rápido: `handleJoin`
  corre después de guardar el mensaje, igual que el turno.

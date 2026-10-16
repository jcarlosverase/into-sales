# Bitácora — Vocero 1.6 y 2.0

Qué se hizo, cómo se probó y dónde vive cada cosa. Una entrada por spec.
Nunca valores de secretos: como mucho, sus últimos 4. El plan está en
`PLAN-2.0.md` del espacio de trabajo del autor; las specs, en `specs/`.

## 2026-10-13 — 025: el despacho recuerda qué debe

**PR**: [#111](https://github.com/kevinrivm/vocero-crm/pull/111), rama
`feat/025-despacho-recuerda`. Spec antes del código (`94e5457`); la
implementación en `c083037`; un arreglo del selftest en `b91e0dc`.

### Qué quedó

- Puerto de Vocero Cloud #111 (`439386e`), #116 (`5325273`, `2fdeff2`) y #117
  (`2624262`). La raíz ya traía el #111 desde el 021 (`hayMensajesSinDespachar`):
  faltaba la memoria.
- Migración `0017_dispatch_message_ids`: una columna `jsonb` nula.
- Con cerebro externo, el despacho anota qué entrantes debe y los entrega
  aunque después haya una respuesta del agente. Un despacho sin mensajes se
  descarta («sin mensajes por despachar»).
- **Diferencia con cloud, decidida aquí**: en la raíz el agente incluido no
  pasa por el outbox. Lleva la misma cuenta en su coalesce (en memoria, como su
  `pending`), lee lo debido después de su propia respuesta y devuelve qué
  leyó.
- **Decisión que Kevin no ha revisado para la raíz**: si el operador contesta
  desde la bandeja dentro de la ventana de agrupado, el agente incluido ya no
  contesta encima (spec, AC5b). En cloud lo confirmó el 12-oct; con el
  despacho la raíz ya se comportaba así.

### Cómo se probó

| Qué | Resultado |
|---|---|
| `typecheck`, `lint`, `test`, `build` | Verdes con banderas apagadas y con `CHANNELS` + `AGENDA`. 1 017 unitarias. CI del PR: 3 de 3. |
| `scripts/e2e-dispatch.mjs` con cerebro | 89/89, tres corridas. Sin el arreglo, 84/89: las rojas son las de «mientras piensa». La de «persona en la ventana» ya pasaba en la raíz: queda como regresión. |
| `scripts/e2e-dispatch.mjs` con el agente incluido | 14/14, tres corridas. Sin el arreglo, 11/14: el orden del turno y las dos de «no contesta encima». |
| `scripts/e2e-selftest.mjs` sin `BRAIN_DISPATCH_URL` | 213/213 en frío sobre una base nueva; `dispatch` queda vacía. |
| Migración | Base vacía; y base en `0016` con un despacho pendiente: `0017` en dos pasadas, la fila queda con `message_ids` nulo y se entrega igual. |
| En vivo, local | Ver abajo. |
| En vivo, Coolify | Ver abajo. |

Tres carreras de los guiones contra la ingesta salieron al repetir corridas, y
ninguna era del producto: la ráfaga de cinco mensajes (se guardaban en otro
orden), la ventana de 24 h tras un botón, y la pausa tras un eco. Las tres se
arreglaron esperando el hecho en vez de un tiempo fijo. El mock de WhatsApp
repetía ids al reiniciar su bandeja dentro del mismo proceso; ya no.

Queda apuntado, fuera de esta spec: el producto ordena los mensajes por hora
de inserción, no por la hora del canal. Dos webhooks de la misma conversación
procesados a la vez pueden guardarse en otro orden.

### Prueba en vivo

Número «Soporte» (…9518, coexistencia) y línea cliente (…9768) por Evolution.
Contesta el agente incluido con el negocio demo y `openai/gpt-4o-mini` por
OpenRouter. Nea contra la raíz por despacho llega con nea-agent#37.

**La raíz no tiene lista de permitidos** (`ALLOWED_WA_IDS` es de Nea). Para que
el agente de pruebas solo le contestara a la línea cliente, el override apuntó
a un relevo local detrás de un túnel de Cloudflare: lo de la línea cliente va
al CRM de pruebas y todo lo demás se reenvía, crudo y con su firma, a donde
apuntaba el override. En las dos ventanas solo pasó tráfico de la línea
cliente.

| | Local (`next start`, commit `b91e0dc`) | Coolify (`vocero-16`, commit `b91e0dc`) |
|---|---|---|
| Override movido (UTC) | 18:48:05 | 18:54:18 |
| Override devuelto (UTC) | 18:49:28 | 18:54:46 |
| Intento 1 | 2.º mensaje a los 4.0 s: misma ventana, una respuesta a los 15.4 s que contesta las dos preguntas | 2.º mensaje a los 7.0 s, con el modelo pensando; respuestas a los 9.1 s (horario) y 12.8 s (envíos) |
| Intento 2 | 2.º mensaje a los 7.0 s, con el modelo pensando; respuestas a los 10.3 s y 14.0 s | — |

El override del número apuntaba a un demo de la clase
(`nea-comida.177.7.62.92.sslip.io`) y ahí volvió las dos veces; se comprobó
antes de moverlo que contesta el reto de verificación, y después de devolverlo
que lo sigue contestando. El de la WABA (`vocero-clase.kevinbelier.cloud`) y el
webhook de la app no se tocaron: al guardar la conexión, el CRM de pruebas vio
el override de la WABA y no registró el suyo.

Seis mensajes de la línea cliente y cinco respuestas del agente en total. El
gasto de OpenRouter no se midió: cinco turnos de `gpt-4o-mini` con el prompt
del demo, del orden de una fracción de centavo. El Laboratorio no se corrió.

**En Coolify el webhook llegó por el relevo, no directo de Meta.** Lo que queda
sin probar es solo ese salto; la verificación de Meta (`hub.challenge`) sí la
contestó la instancia.

### Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Proyecto Coolify `vocero-16` | `cz6ssrdhn2pfuzkkmjwm0drq`, entorno `production` (`qnk5mqg4pzxzbfolg95vnmfq`) |
| Servicio `vocero16-crm` (app + Postgres) | `rwzjzhsi5boaujr25snbjuxe`; app `zit4a8bggjnhuwympeonvera`, base `jrur7xgv1oluirvyhlqfpedu` |
| URL | `https://vocero16.177.7.62.92.sslip.io` (healthcheck de Coolify apagado en el compose) |
| Servidor | `sd6cdcmljjxi5sufn6d0bzey`, el único del panel. **`COOLIFY_SERVER_UUID` de la bóveda trae otro valor y no existe en ese panel**: hay que corregirlo. |
| Secretos de la instancia (`BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, verify token, contraseña de Postgres) | Los generó Coolify (`SERVICE_PASSWORD_*`, `SERVICE_REALBASE64_*`); viven solo en el servicio. No pasaron por el chat. |
| Llave de OpenRouter de la instancia | Cifrada en su base (Ajustes → IA). Sale de `LLM_API_KEY` de la bóveda. |
| Token de WhatsApp de la instancia | Cifrado en su base. Sale de `WA_TOKEN` de la bóveda. |
| Dueño de la instancia | Correo `OWNER_EMAIL` de la bóveda; contraseña en `.env.vocero16` del espacio de trabajo. |
| Override original del número | `.override-soporte.json` del espacio de trabajo (su último tramo es un secreto). |
| Guiones de la prueba en vivo | `ops/` del espacio de trabajo: `override.mjs`, `relay.mjs`, `evolution.mjs`, `vivo.mjs`. Fuera de este repo. |
| Local | Postgres propio en Docker (`vocero-20-pg`, puerto 5433): bases `vocero_025_*`. `.env.e2e-*` y `.env.vivo` en el clon, ignorados por git. |

Al levantar el compose de desarrollo, Docker recreó el contenedor del Postgres
compartido de la máquina (`vocero-dev-postgres-1`) sobre su mismo volumen: sus
bases siguen ahí y no se usó (tiene otra contraseña). Las pruebas corrieron en
el Postgres propio.

El agente incluido de la instancia de Coolify quedó **apagado** y su número
conectado. Se reutiliza para las pruebas en vivo de 022 a 028.

Para repetir la prueba: `node ops/relay.mjs 3281 <url>`, túnel a `:3281`,
`node ops/override.mjs mover <túnel> <env> [url]`,
`node ops/vivo.mjs dos-mensajes <url> <env>`, `node ops/override.mjs devolver`.

### Qué sigue

022, canal TikTok por Zernio.

## 2026-10-13 — 022: canal de TikTok por Zernio

**PR**: [#112](https://github.com/kevinrivm/vocero-crm/pull/112), rama
`feat/022-canal-tiktok`. Spec antes del código (`b32d4da`); implementación en
`6bd9b4d`. **Abierto, sin mergear**: falta la prueba en vivo.

### Qué quedó

- `tiktok` es un canal más, opcional (`CHANNELS`), con Zernio como única
  fuente: tabla `tiktok_credentials` (migración `0018_canal_tiktok`), adaptador
  `src/server/tiktok/`, webhook `/api/webhooks/tiktok/<token>`, Ajustes →
  TikTok, distintivo y filtro en la bandeja. Identidad `tt:<id>`.
- Los límites de TikTok se declaran en las capacidades del canal y el envío
  los comprueba antes de llamar a Zernio: ventana de 48 h sin forma de reabrir
  (409 `window_closed`), 10 salientes desde el último entrante (409
  `message_limit`, nuevo en `/api/bot/messages`) y 6,000 caracteres.
- Dos cambios del núcleo que el canal obligó a hacer: la ventana se pregunta
  por canal (`windowMsFor`) en la bandeja, en `/api/bot/context` y en el
  despacho; y el tope de 4,096 caracteres dejó de ser uno global en el esquema
  de la API para declararse en WhatsApp. Los demás canales no cambian.
- `sendZernioMessage` lee `data.messageId`, que es donde la API real devuelve
  el id. El mock respondía con otra forma y la raíz guardaba un id inventado
  para Instagram y Messenger por Zernio.

### Decisiones que Kevin no ha revisado

- **La imagen saliente quedó fuera** (spec, D9), aunque la fila del plan la
  enumeraba. Zernio la acepta como URL pública o `multipart`; la raíz no
  expone sus adjuntos sin sesión y la documentación no nombra el campo del
  `multipart`. Ningún canal social de la raíz envía adjuntos todavía.
- **Si el agente topa con el tope de 10, calla sin traspasar** (D7).
- **WhatsApp: el límite de 4,096 se movió del esquema de la API al canal**
  (D11). Sigue respondiendo 422; cambia el texto del error.

### Cómo se probó

| Qué | Resultado |
|---|---|
| `typecheck`, `lint`, `test`, `build` | Verdes en las dos configuraciones; la completa ya incluye `tiktok`. 1 040 unitarias. CI del PR: 3 de 3. |
| `scripts/e2e-tiktok.mjs` | 52/52, dos corridas sobre el código final, contra el mock de Zernio: conexión, firma, dedup, agente, operador, el undécimo mensaje, 6,000 caracteres, 30 y 49 horas, descartes y reparto por plataforma. |
| `scripts/e2e-dispatch.mjs` | 94/94 con cerebro (sección nueva: `channel: "tiktok"`, `tt:`, `windowExpiresAt` a 48 h) y 14/14 con el agente incluido. |
| `scripts/e2e-messenger.mjs` · selftest | 42/42 · 213/213. |
| Migración | Base vacía; la que venía de `0016`/`0017` con su despacho pendiente; y la instancia de Coolify, que conservó sus 9 conversaciones. |
| Interfaz | Ajustes → TikTok, distintivo, filtro y compositor con la ventana cerrada, vistos en el navegador contra la app local. |
| Coolify | `vocero-16` sirve `6bd9b4d` con `CHANNELS=whatsapp,tiktok`. La cuenta se conectó desde la API de ajustes: la llave se validó contra el Zernio real. |
| **En vivo** | **Pendiente de verificación humana.** |

### Por qué falta la prueba en vivo

En Zernio, la cuenta `kevin.belier` de TikTok figura como **personal**
(`tiktokAccountType: personal`, conectada el 13-oct). TikTok solo permite
mensajes directos por API a cuentas **Business**: mientras siga así no llega
ningún webhook. Además hace falta que una persona mande el DM (TikTok no deja
que el negocio inicie). Lo que falta, en orden:

1. Pasar `@kevin.belier` a cuenta Business en TikTok, con los mensajes
   directos abiertos, y reconectarla en Zernio si este no refleja el cambio.
2. Dar de alta en Zernio el webhook de la instancia, **acotado a esa cuenta**
   (`accountIds`), con el evento `message.received` y el secreto que ya está
   en `.env.vocero16`. La llave de Zernio también sirve cuentas de clientes y
   ya hay un webhook de equipo hacia el CRM de uno de ellos: sin `accountIds`,
   los DMs de esas cuentas llegarían a la instancia de pruebas.
3. Encender el agente de `vocero-16` solo durante la prueba: la raíz no tiene
   lista de permitidos y contestaría a cualquiera que escriba a esa cuenta.
4. Un DM desde un TikTok personal: entra a la bandeja, el agente contesta, el
   operador responde, y el undécimo mensaje se rechaza con 409.

### Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Instancia | La misma de la 025 (`vocero16-crm`, `rwzjzhsi5boaujr25snbjuxe`), ahora desde la rama `feat/022-canal-tiktok`, con el agente apagado. |
| Cuenta de TikTok en Zernio | `6ace6bfe5d6259b1df1e1bf2` (`@kevin.belier`), perfil «Kevin Belier». |
| Llave de Zernio de la instancia | Cifrada en su base (Ajustes → TikTok). Sale de `ZERNIO_API_KEY` de la bóveda. |
| Secreto del webhook de TikTok | `TIKTOK_WEBHOOK_SECRET` en `.env.vocero16` del espacio de trabajo, y en la tabla `tiktok_credentials` de la instancia (sin cifrar, igual que el de Instagram y el de Messenger). |
| Guiones | `ops/zernio.mjs` (solo enseña las cuentas de Kevin) y `ops/vivo.mjs tiktok | estado`. |
| Local | Bases `vocero_022_tiktok` y `vocero_022_cerebro` en `vocero-20-pg`; `.env.e2e-tiktok` y `.env.e2e-cerebro22` en el clon. |

No se creó ningún webhook en Zernio ni se tocó ninguna cuenta que no sea la de
Kevin.

### Qué sigue

La prueba en vivo de la 022 cuando la cuenta sea Business; después, 023.

## 2026-10-13 — 1.5.1, la clase multicanal y el starter 2.2.0

Escrito después de los hechos: fue un día de clase y la bitácora quedó para el
final.

### Versión 1.5.1

PR #113 (`dad742f`), tag `v1.5.1`, imagen `ghcr.io/kevinrivm/vocero-crm:1.5.1`
y release en GitHub. Saca la 025 antes que la 1.6.0, junto con el despacho al
cerebro que ya estaba en `main`.

### 022, TikTok

PR #112 abierto, sin mergear. Verde con simuladores (`e2e-tiktok` 52/52, dos
corridas). **Pendiente de verificación humana:** `@kevin.belier` es cuenta
personal y TikTok solo entrega mensajes por API a cuentas Business; la
solicitud de Kevin está en revisión.

### Demo de la clase (instancia `vocero16-crm`, ya borrada)

- La instancia de pruebas pasó a la imagen `1.5.1` con
  `CHANNELS=whatsapp,instagram,messenger` y el agente incluido encendido.
- **Dominio:** con permiso expreso de Kevin, `vocero-clase.kevinbelier.cloud`
  se le quitó a la app `vocero-crm` del proyecto `vocero` (instalación anterior
  del starter) y se le dio a la demo. Después de la demo se liberó para la
  instalación del starter.
- **WhatsApp «Soporte»:** el override del número se movió de la Nea del demo de
  comida a la demo (20:58 UTC) y se reapuntó al cambiar el dominio (~21:03
  UTC). **No se devolvió**: al terminar se quitó (~22:15 UTC) porque el número
  pasó a la instalación de la clase, por decisión de Kevin. El original sigue
  en `.override-soporte.json`.
- **Zernio:** webhook `vocero-16-clase` (`6ace9b814a6701990705765e`), limitado
  al Instagram y a la página de Kevin; desactivado al terminar.
- **Probado en vivo:** WhatsApp, entrada y respuesta del agente en 11 s.
  Instagram y Messenger: conexión y evento de prueba de Zernio en 200; los DM
  reales los mandó Kevin en la clase, no quedaron medidos aquí.
- Observado y sin investigar: con dos preguntas seguidas por WhatsApp, el
  modelo las leyó en el mismo turno y contestó solo la primera.

### Starter 2.2.0

Repo local `Vocero-cloud astra/vocero-starter-v2` (sin remoto), commit
`a7b8de7`, tag `v2.2.0`, zip al lado. Agrega `CHANNELS` y `AGENTE` al `.env`,
las skills `conectar-canales` y `agente-incluido` y el guion `canales.mjs`.
Ensayado contra Zernio real y una instancia aparte (`ensayo-starter-crm`, ya
borrada). Kevin lo corrió completo en la clase: de ahí salió la instalación
que queda.

### Qué queda en Coolify

| Qué | Dónde |
|---|---|
| Instalación de la clase (se queda como instancia de pruebas) | Proyecto `vocero-clase` (`yyojx68tpzqbyrlfglhstbbn`): app `vocero-crm` (`3jinuviignszpotzzmvs6nrf`), base `vocero-clase-db` (`apppb0cmt0hwzzyoe8z6a699`). `https://vocero-clase.kevinbelier.cloud`, imagen `1.5.1`, tres canales |
| Sus secretos | En el `.env` del starter de Kevin (`Downloads/vocero-starter-v2`) y en las variables de la app. La bóveda del espacio no los tiene |
| WhatsApp «Soporte» | Override de la WABA hacia `vocero-clase…`; sin override en el número |
| Proyectos `vocero-16` y `vocero` | Vacíos |

**Borrado (noche del 13 al 14, hora UTC; con volúmenes):** servicios `vocero16-crm` y
`ensayo-starter-crm`; del proyecto `vocero`, las apps `vocero-crm`
(`anhoehhz…`) y `nea` y las bases `vocero-db` y `nea-db`. Se hizo **por la API
de Coolify y no por el MCP**, con autorización expresa de Kevin: el MCP
devolvía «el usuario rechazó» sin mostrarle el diálogo. Guion
`ops/borrar-coolify.mjs`, de lista cerrada. Los tres demos multinicho no se
tocaron.

El demo de comida se quedó sin WhatsApp: su número es ahora el de la
instalación de la clase.

### Qué sigue

Poner la 022 al día con `main` y empezar la 023 (Ajustes → Canales).

## 2026-10-13 — 023: Ajustes → Canales y arreglos de Zernio

PR #115. Carril ligero, sin migración. Spec escrita antes del código
(`specs/023-ajustes-canales/spec.md`).

También se mergeó la 022 (PR #112) con su prueba en vivo **pendiente de
verificación humana**: TikTok no entrega mensajes por API a la cuenta personal
de prueba. El canal va apagado por defecto y el CHANGELOG lo dice.

### Qué se probó

| Qué | Resultado |
|---|---|
| Gates (typecheck, lint, unitarias, build) | Verde; 1,069 unitarias |
| `scripts/e2e-channels.mjs` (nuevo) | 73/73, en una base nueva y repetido sobre la misma |
| `e2e-messenger` · `e2e-tiktok` | 42/42 · 52/52 |
| `e2e-despacho` | 94/94 con cerebro, 14/14 con el agente incluido |
| `e2e-selftest` | 213/213 |
| Interfaz en local | Estado, Instagram, Messenger y TikTok en claro y oscuro; Estado e Instagram en móvil (sin desbordar); elegir entre varias cuentas; reparar el webhook. Capturas con Playwright |

El guion encontró un fallo de diseño antes de salir: con la lectura de los
webhooks de Zernio guardada 10 minutos, un secreto que cambiara en Zernio
dejaba al CRM rechazando entregas todo ese tiempo. Ahora, si la firma no
coincide, se relee como mucho una vez por minuto (`WEBHOOKS_RECHECK_MS`), con
su prueba unitaria.

### En vivo (instancia `vocero-clase`, imagen `1.6.0-rc.1`)

Para probar una rama en una instancia que corre desde imagen se publicó un
**prelanzamiento**: tag `v1.6.0-rc.1` sobre el commit `53afca9` de la rama.
Publica `ghcr.io/kevinrivm/vocero-crm:1.6.0-rc.1`; `latest` y `1.5.1` no se
movieron (se comprobó por digest). `/api/health` sigue diciendo `1.5.1` porque
`package.json` no se tocó: lo que distingue la imagen es el commit.

Con la llave real de Zernio y las cuentas de Kevin:

- `PUT /api/settings/instagram` y `messenger` **sin `accountRef`** → 200, con
  la misma cuenta que ya había y su nombre (Messenger no lo tenía guardado).
- En Zernio sigue habiendo **un** webhook hacia la instancia (el que creó el
  starter): activo, `message.received`, sus dos cuentas. Los otros cuatro
  webhooks de la llave quedaron igual.
- Entrega firmada con el secreto que tiene Zernio → 200; firma rota → 401;
  sin firma → 401. El evento de prueba de Zernio llegó sin registrar fallos.
- `GET /api/settings/channels`: los tres canales conectados, con su último
  mensaje y cuenta y webhook sanos; sin llave ni segmento del webhook en la
  respuesta.
- WhatsApp: un mensaje real de la línea cliente (Evolution) entró y el agente
  contestó (`delivered`).

**Pendiente de verificación humana:** un mensaje directo real a Instagram y
otro a la página, desde una cuenta personal, ya con esta imagen. Las pantallas
en la instancia viva tampoco se abrieron (entrar con contraseña a un sitio que
no es local no lo hace el asistente): se revisaron en local.

### Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Instancia | Proyecto Coolify `vocero-clase` (`yyojx68tpzqbyrlfglhstbbn`), app `3jinuviignszpotzzmvs6nrf`, etiqueta de imagen `1.6.0-rc.1` desde el 2026-10-14 00:43 UTC |
| Credenciales del dueño de la instancia | `.env` de la carpeta del starter de Kevin; los guiones las leen de ahí (`ops/clase.mjs`) y guardan solo la cookie de sesión en el espacio de trabajo |
| Secreto de firma de Zernio | En la columna `webhook_secret` de las credenciales de cada canal y en el webhook de Zernio. Nunca sale en una respuesta de la API. **Esa columna va sin cifrar desde la 014** (el token sí va cifrado): queda anotado para cifrarla con una migración |
| Guiones de esta prueba | `ops/vivo-023.mjs` (`salud`, `estado`, `reconectar`, `webhook`, `firma`, `whatsapp`, `ajenos`), fuera del repo |
| Local | Base `vocero_023_canales` en el Postgres propio (5433); `.env.e2e-canales` en el clon, ignorado por git |

Visto de paso y sin tocar: la llave de Zernio de Kevin tiene un webhook activo
de otro CRM **sin límite de cuentas**, así que también recibe los eventos de
sus cuentas personales. Es justo el caso que el límite por cuentas de esta spec
evita en las instalaciones nuevas.

### Qué sigue

024, texto social sin formato de WhatsApp y ventana humana.

## 2026-10-13 — 024: texto de la IA en redes y ventana humana

PR #116. Carril ligero, sin migración. Spec escrita antes del código
(`specs/024-texto-social-ventana-humana/spec.md`).

Dos cosas se decidieron distinto de como venían en el plan, y quedan dichas en
el spec:

- La etiqueta de la bandeja es **«ventana humana»**, no «atención humana»: ese
  nombre ya es el traspaso a una persona (con la IA en pausa) y los dos
  estados se confundían en la misma pantalla.
- Entre 24 horas y 7 días, en Instagram y Messenger, **la IA ya no envía**
  (`/api/bot/messages` → 409 `window_closed`). Antes enviaba con la etiqueta
  de agente humano, que Meta reserva a personas. Es lo que `windowOpen` y el
  contrato del despacho ya decían; el contrato ganó dos frases que lo aclaran.

### Qué se probó

| Qué | Resultado |
|---|---|
| Gates (typecheck, lint, unitarias, build) | Verde; 1,095 unitarias |
| `scripts/e2e-social-window.mjs` (nuevo) | 53/53, en base limpia y repetido |
| `e2e-canales` | 73/73 en base limpia y 73/73 sobre una base ya usada |
| `e2e-messenger` · `e2e-tiktok` | 42/42 · 52/52 |
| `e2e-despacho` | 94/94 con cerebro, 14/14 con el agente incluido |
| `e2e-selftest` | 213/213 |
| Bandeja en local | Instagram con la ventana abierta, humana (30 h) y cerrada (8 días), en claro y oscuro. Capturas con Playwright |

Correr `e2e-canales` después de `e2e-ventana-social` sobre la misma base
destapó un fallo de la 023: con dos canales guardados con **llaves distintas
de la misma cuenta de Zernio** (se rota la llave y solo se reconecta uno), al
dar de alta el webhook la segunda llave lo dejaba solo con «sus» cuentas y el
otro canal dejaba de recibir en silencio. Ahora cada llave deja el webhook con
todas las cuentas de la organización que esa llave ve (`webhookAccountIds`,
con sus pruebas). Va en este mismo PR.

### En vivo (instancia `vocero-clase`, imagen `1.6.0-rc.2`)

Tag `v1.6.0-rc.2` sobre el commit `980b47d` de la rama; la instancia lo corre
desde el 2026-10-14 01:16 UTC (`/api/health` lo confirma por commit).

- Estado de los canales: los tres conectados y sanos; Messenger ya enseña el
  nombre de la página.
- La bandeja trae la ventana humana en sus dos conversaciones sociales reales
  (abiertas, a 2.3 h del último mensaje) y `null` en WhatsApp.
- WhatsApp: un mensaje real de la línea cliente entró y el agente contestó
  (`delivered`). La respuesta no traía negritas, así que «WhatsApp conserva su
  formato» queda demostrado solo por el guion.

**Pendiente de verificación humana**, porque hace falta que una persona
escriba desde su cuenta: que una respuesta del agente con negritas llegue sin
asteriscos a Instagram y a Messenger, y ver en la bandeja de la instancia el
aviso de ventana humana pasadas 24 horas. No se usaron las dos conversaciones
sociales que ya existen: no se le escribe a quien no lo pidió.

### Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Instancia | La misma de la 023; etiqueta de imagen `1.6.0-rc.2` |
| Guiones de esta prueba | `ops/vivo-024.mjs` (`ventanas`, `whatsapp`), fuera del repo |
| Local | Bases `vocero_023_canales` y `vocero_024_limpia` en el Postgres propio (5433); `.env.e2e-canales` y `.env.e2e-limpia` en el clon, ignorados por git |

Los guiones E2E inician sesión una vez cada uno y el CRM limita a 10 inicios
cada 10 minutos por IP: correr más de ocho seguidos contra el mismo proceso da
429 en el siguiente. Se reinicia la app entre tandas.

### Qué sigue

026, eliminar conversación (ciclo completo: evento `conversation.deleted` en
el contrato del despacho).

## 2026-10-13 — 026: eliminar una conversación

PR #117. Ciclo completo: spec, plan y tareas antes del código, y enmienda del
contrato del despacho (`specs/021-despacho-estandar/contracts/despacho.md`:
evento `conversation.deleted` y la regla del `conversation.id` nuevo). **Sin
migración**: en el raíz las foráneas ya caen en cascada o quedan en NULL donde
hace falta; el módulo solo añade lo que una cascada no hace (adjuntos, ficha y
la cita por venir).

### Qué se probó

| Qué | Resultado |
|---|---|
| Gates (typecheck, lint, unitarias, build) | Verde; 1,104 unitarias |
| Prueba gemela del contrato (`tests/unit/forget-contract.test.ts`) | El cuerpo y la firma coinciden byte a byte con `nea-agent/tests/test_olvido.py` |
| `scripts/e2e-delete-conversation.mjs` (nuevo) | 56/56 con cerebro y `AGENDA=on`; 40/40 sin despacho con agenda; 31/31 sin agenda |
| `e2e-despacho` | 94/94 con cerebro, 14/14 con el agente incluido |
| `e2e-ventana-social` · `e2e-canales` · `e2e-messenger` · `e2e-tiktok` | 53/53 · 73/73 · 42/42 · 52/52 |
| `e2e-selftest` | 213/213 |
| Bandeja en local | La entrada al fondo de Detalles y el diálogo, con y sin la casilla, en claro y oscuro; Escape cancela; un miembro del equipo no ve la opción |

Dos cosas del arnés, no del producto:

- `e2e-tiktok` leía la conversación antes de que la ingesta sellara
  `lastInboundAt` y en un servidor frío fallaba el check de las 30 horas. Ahora
  espera, igual que `e2e-ventana-social`.
- El selftest con `AGENDA=on` dio 5 fallos de Zoom en una corrida: el entorno
  de esa corrida no apuntaba al simulador de Zoom y la app le habló al Zoom
  real. Con su entorno de siempre da 213/213.

### En vivo (instancia `vocero-clase`, imagen `1.6.0-rc.3`)

Tag `v1.6.0-rc.3` sobre el commit `771bfde`; la instancia lo corre desde el
2026-10-14 01:49 UTC.

**No se borró nada de nadie.** `ops/vivo-026.mjs` crea dos conversaciones
sintéticas de Instagram —remitentes que no existen, con el mensaje fechado
hace 8 días para que el agente no pudiera enviar nada— entregando eventos
firmados con el secreto que Zernio tiene para la instancia, y las elimina:

- A, alcance `hilo`: 200, sale de la bandeja, sus mensajes ya no existen, el
  contacto se queda con su etapa, borrarla otra vez da 404. Al «volver a
  escribir» es otra conversación del mismo contacto, que se limpia con
  `?contacto=1`.
- B, alcance `contacto`: 200, conversación y contacto dejan de existir.
- `agente: "no_aplica"`: la instancia no tiene despacho.
- Al terminar, la bandeja tiene las mismas 4 conversaciones que antes y ningún
  rastro de la prueba. El agente no le escribió a nadie.

**No se probó en vivo** el aviso a un cerebro de verdad: la instancia usa el
agente incluido, y Nea 1.x frente al raíz no recibe despachos (eso llega con
nea-agent#37, en la 2.0). Lo cubren el guion (un cerebro de prueba que verifica
la firma) y la prueba gemela. Nea 1.1 sí olvida por la otra vía del contrato:
al ver un `conversation.id` nuevo para la misma persona empieza de cero
(`_olvidar_si_es_otra` en su `turn.py`). **Pendiente de verificación humana:**
abrir el diálogo en la bandeja de la instancia.

### Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Instancia | La misma; etiqueta de imagen `1.6.0-rc.3` |
| Guion de esta prueba | `ops/vivo-026.mjs`, fuera del repo |
| Local | Base `vocero_026_eliminar` en el Postgres propio (5433); `.env.e2e-eliminar` (cerebro y agenda) y `.env.e2e-eliminar-incluido` en el clon, ignorados por git |

### Qué sigue

027, importar contactos desde un CSV.

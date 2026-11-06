# 1023 — Tarjeta de sellos virtual

**Created**: 2026-11-04

**Status**: Especificada antes de escribir código. Revisada por
Juan Carlos el 2026-11-04. Plan en [plan.md](plan.md) y tareas en [tasks.md](tasks.md).
Los tres cortes implementados el 2026-11-05 y verificados ese día en un
iPhone y un Android reales (T024).

**Input**: Juan Carlos, el 2026-11-04: «quiero agregar la funcionalidad de
tarjeta de sellos virtual» y «quiero ampliar mi CRM a cualquier negocio, ya
tengo cuenta Apple Developer». Referencia: un video de nauta (cafetería
«Café La Esquina», tarjeta de 10 sellos en Google Wallet, alta por QR o NFC y
«+ Sumar sello» desde el panel de Clientes).

**Carril**: ciclo completo (Principio VI). Toca el **modelo de datos** (cuatro
tablas nuevas, migración aditiva `0027`; ver [data-model.md](data-model.md)),
publica rutas nuevas (la página pública de la tarjeta y el servicio web de
Apple Wallet) y consume un **contrato nuevo de into-central** (su spec 016; resumen en
[contracts/central-wallet.md](contracts/central-wallet.md)). Requiere una
**enmienda de la constitución** (Principios II y VIII), ratificada y aplicada (1.6.0):
[constitution-amendment.md](constitution-amendment.md). La configuración de
Apple, Google, el central y cada CRM está en [quickstart.md](quickstart.md).

## Problema

Los negocios de visita frecuente (cafeterías, barberías, salones, lavanderías,
restaurantes, gimnasios) premian la recompra con una tarjeta de cartón: se
moja, se pierde, el cliente no la trae y el negocio no sabe quién vuelve. El
negocio ya atiende por WhatsApp con IntoSales, pero sus clientes de mostrador
no quedan en el CRM y no hay un motivo para que vuelvan a escribir.

La tarjeta de sellos virtual vive en el celular del cliente (Apple Wallet,
Google Wallet o una página web), la sella el equipo desde el CRM y deja a cada
cliente de mostrador como contacto de WhatsApp. Abre IntoSales a cualquier
negocio con clientes que vuelven, no solo a los que venden por conversación.

## Historias

**H1 — El dueño crea su tarjeta (P1).** En Ajustes → «Tarjeta de sellos»
define el nombre («Café La Esquina»), cuántos sellos completan la tarjeta
(de 2 a 30), el premio («1 bebida gratis»), las condiciones (texto corto), el
color y, si quiere, un mínimo de horas entre sellos. Ve una vista previa de
la tarjeta y descarga el **cartel del mostrador**: un QR para imprimir y el
mismo enlace para grabar en un sticker NFC.

**H2 — El cliente se une por WhatsApp (P1).** Escanea el QR del mostrador (o
acerca su celular al sticker): se abre WhatsApp con el mensaje «Quiero mi
tarjeta de sellos» ya escrito. Al enviarlo, el CRM le responde en esa misma
conversación con el enlace a su tarjeta. Como el cliente escribió primero, la
respuesta va dentro de la ventana de 24 horas y no necesita plantilla.

**H3 — El cliente guarda su tarjeta (P1).** El enlace abre la página pública
de su tarjeta: nombre del negocio, sellos (4/10), premio y un QR. Desde ahí la
agrega a **Apple Wallet** (iPhone) o **Google Wallet** (Android). Sin wallet,
la página sigue sirviendo como tarjeta.

**H4 — El equipo suma un sello (P1).** En la ficha del contacto, o
escaneando el QR de la tarjeta del cliente con el celular del equipo, pulsa
«+ Sumar sello». La tarjeta del wallet y la página se actualizan solas en
segundos, con un aviso en el celular del cliente («Te faltan 6 sellos»).

**H5 — El cliente canjea su premio (P1).** Con la tarjeta completa, el equipo
pulsa «Canjear premio». La tarjeta vuelve a empezar (los sellos de más pasan
a la siguiente) y el canje queda registrado.

**H6 — El dueño mide la recompra (P2).** En Resultados, una sección «Tarjeta
de sellos» del periodo: tarjetas nuevas, sellos, canjes, tarjetas guardadas
en un wallet y clientes que volvieron (dos sellos o más).

**H7 — El agente sabe de la tarjeta (P3).** Si el cliente pregunta por
WhatsApp «¿cuántos sellos tengo?», el agente responde con sus sellos y le
reenvía el enlace.

## Decisiones

**D1 — Módulo de IntoSales tras una bandera, no una app aparte.** La bandera
es `STAMP_CARD` (mismos valores que `AGENDA`). Apagada, no hay pantalla, ni
rutas (404), ni palabra clave, ni sección en Resultados. Reutiliza contactos,
WhatsApp, el agente, Resultados, la app instalable, el instalador y el plan
del central.

**D2 — La tarjeta es de un contacto.** Una tarjeta por contacto y por
programa. Unirse por WhatsApp crea o reutiliza el contacto por su teléfono
(spec 003), así que no hay formulario público ni teléfonos sin verificar.
Desde la ficha, el equipo también puede crear la tarjeta a mano.

**D3 — Un programa activo por instancia en esta versión.** Se puede pausar
(no se suman sellos y la tarjeta lo dice) y editar. Cambiar el número de
sellos no toca las tarjetas en curso hasta su siguiente canje.

**D4 — La palabra clave entra antes que el agente.** Un mensaje entrante que
coincide con la frase de alta (por defecto «Quiero mi tarjeta de sellos»,
editable, comparada sin mayúsculas, tildes ni signos) recibe la respuesta
fija con el enlace, y la IA no contesta ese mensaje. La respuesta se puede
editar y lleva `{nombre}`, `{negocio}` y `{enlace}`. Solo aplica a WhatsApp
en esta versión.

**D5 — La página pública no revela nada sin el token.** `/c/<token>`, con un
token aleatorio de 128 bits por tarjeta y sin sesión. Muestra solo el nombre
del negocio, el programa, los sellos y el QR, nunca el teléfono ni el nombre
del cliente. Un token que no existe responde 404, `noindex` y con límite de
pedidos por IP.

**D6 — El QR de la tarjeta lleva al panel, no a los datos.** Codifica
`https://<crm>/s/<serial>`. Alguien del equipo con sesión abierta llega a la
pantalla para sellar. Cualquier otra persona va a «Entrar» y no ve nada.

**D7 — Freno contra sellos dobles.** Si el programa tiene un mínimo de horas
entre sellos, un segundo sello antes de tiempo pide confirmación expresa.
Cada sello, canje y ajuste queda en la bitácora con quién lo hizo, y solo un
administrador puede restar sellos.

**D8 — Los wallets son un conector opcional a través de into-central.** Las
tarjetas de Apple y Google se firman con las cuentas de **into**: la de Apple
Developer (Pass Type ID) y la de emisor de Google Wallet. Esas credenciales
viven solo en into-central. El CRM le pide al central que firme y que avise
de los cambios, con el mínimo de datos:
- **Apple**: el CRM arma el pase y le manda al central solo el
  `manifest.json` (nombres de archivo y sus hashes). El central lo firma y le
  devuelve la firma. Para avisar de un cambio, el CRM le da al central los
  tokens de push de los dispositivos y el central envía el aviso vacío a
  APNs. El dispositivo descarga el pase actualizado **del CRM** (servicio
  web de Apple Wallet en el CRM).
- **Google**: el CRM le manda al central la clase (el programa) y el objeto
  (la tarjeta). El central firma el enlace «Guardar en Google Wallet» y
  aplica las actualizaciones con la API de Google. El objeto lleva sellos,
  premio y un serial aleatorio, **sin nombre ni teléfono del cliente**.
- El central deduce el cliente de la llave de licencia y fuerza que los ids
  de Google y los seriales lleven el prefijo de ese cliente. Nunca acepta un
  id de cliente.

**D9 — Sin central o sin wallet, la tarjeta funciona igual.** La página web
es el camino sin dependencia externa (Principio II, condición 3). Sin
`INTO_CENTRAL_URL`, sin llave, con un plan que no incluye wallet o con el
central caído, los botones de wallet no aparecen o lo dicen. El sello se
guarda siempre, y las actualizaciones pendientes se reintentan (Principio IV:
idempotentes por serial y versión).

**D10 — Los avisos del cambio los da el wallet, no WhatsApp.** Sumar un sello
no envía WhatsApp. El aviso lo da el wallet (gratis, en la pantalla de
bloqueo). Opcionalmente, al **completar** la tarjeta el CRM envía un WhatsApp:
texto libre si la ventana de 24 horas está abierta, o la plantilla de
categoría «utilidad» que el negocio elija si está cerrada. Viene apagado.

**D11 — Diseño de la tarjeta.** El pase de Apple es de tipo `storeCard`: logo
de la instancia (white-label), color del programa y una franja (`strip.png`)
con los círculos de los sellos dibujados por el CRM. En Google es una
`LoyaltyClass` y un `LoyaltyObject` con los sellos como `loyaltyPoints` y la
misma imagen. La página web usa el sistema de diseño into.

**D12 — Tope de clientes con tarjeta por plan (2026-11-05, Juan Carlos).**
Comunidad 50, Emprendedor 300, Pyme 2,000, Empresa sin tope. Sale del plan del
último latido (`src/lib/stamp-card.ts`, por el final del código: `SH-PYM` y
`CE-PYM` son Pyme). Sin central o sin llave es Comunidad. El tope frena solo
las tarjetas **nuevas**: quien ya la tiene sigue sumando y canjeando, y bajar
de plan no quita ninguna. Por WhatsApp, el cliente nuevo recibe una respuesta
fija en vez de silencio; Ajustes muestra el uso y avisa desde el 90 %.
*Decidido sin pedido expreso, a revisar:* Plan Esencial (`SH-ESE`) lleva el
tope de Emprendedor, su equivalente propio, y un plan con un código que el CRM
no conoce lleva 300, para no castigar a quien paga.

**D13 — Consentimiento y privacidad al guardar la tarjeta (2026-11-05, Juan
Carlos; Ley 29733).** La tarjeta en la página web no pide nada más: el cliente
la pidió por WhatsApp. Guardarla en el celular sí: antes de los botones de
wallet, la página pide marcar la aceptación, con enlace a
`/c/<token>/privacy`, que dice quién es responsable, qué datos se usan, qué
hacen into, Apple y Google, y cómo pedir que se borren. Se guardan la fecha de
la primera aceptación y la versión del texto (`CONSENT_VERSION`). Sin aceptar,
`/c/<token>/apple` y `/google` vuelven a la página y nada sale hacia el
central. Las tarjetas ya guardadas en un wallet siguen actualizándose; si el
cliente vuelve a descargarla, acepta entonces.

## Criterios de aceptación

- **AC1** — Con `STAMP_CARD` apagada, `/c/*`, `/s/*`, `/api/stamp-card/*` y
  `/api/wallet/apple/*` responden 404, no hay entrada en Ajustes ni sección en
  Resultados y la frase de alta no hace nada.
- **AC2** — `PUT /api/stamp-card/program` valida nombre (1–40), sellos
  (2–30), premio (1–60), condiciones (hasta 300), color hex, horas mínimas
  (0–168), frase y respuesta de alta. Algo inválido responde 422. Solo un
  administrador lo cambia.
- **AC3** — Un WhatsApp entrante con la frase de alta (con otras mayúsculas,
  tildes o signos) crea la tarjeta del contacto, o reutiliza la que ya
  tiene, y responde con el enlace. La IA no contesta ese mensaje. Repetirlo
  no crea otra tarjeta.
- **AC4** — `/c/<token>` muestra negocio, programa, sellos, premio y QR, sin
  datos del cliente, con `noindex`, a 360 px sin scroll horizontal. Un token
  inválido da 404.
- **AC5** — «+ Sumar sello» suma uno y lo registra con quién y cuándo. Antes
  del mínimo de horas pide confirmación. Un doble clic o un reintento con la
  misma llave de idempotencia no suma dos.
- **AC6** — Con la tarjeta completa, «Canjear premio» resta los sellos del
  programa, cuenta un canje y lo registra. Sin la tarjeta completa, el botón
  no aparece y la API responde 409.
- **AC7** — Abrir `/s/<serial>` sin sesión lleva a «Entrar» sin mostrar
  nada. Con sesión, muestra la pantalla para sellar esa tarjeta.
- **AC8** — Con el central activo y un plan con wallet, `/c/<token>` ofrece
  «Agregar a Apple Wallet» (descarga un `.pkpass` válido que el iPhone acepta)
  y «Guardar en Google Wallet». Tras un sello, el pase de Apple se actualiza
  vía el servicio web y el de Google vía el central en menos de un minuto.
- **AC9** — El servicio web de Apple en `/api/wallet/apple/v1/…` cumple el
  protocolo de Apple: registrar y dar de baja un dispositivo, listar seriales
  cambiados desde una fecha, entregar el último pase y recibir el log, con
  `Authorization: ApplePass <token>` validado contra el hash guardado.
- **AC10** — Sin central, con el central caído o con un plan sin wallet, el
  sello se guarda, la página funciona y los botones de wallet no aparecen o
  explican por qué. Las actualizaciones pendientes se reintentan.
- **AC11** — Al central nunca le llegan nombre, teléfono ni conversaciones.
  Lo verifica una prueba que inspecciona cada cuerpo enviado al mock del
  central.
- **AC12** — Resultados muestra, para el periodo, tarjetas nuevas, sellos,
  canjes, tarjetas en un wallet y clientes que volvieron, excluyendo el
  Laboratorio.
- **AC13** — Ajustes → Tarjeta de sellos tiene vista previa, descarga el
  cartel del mostrador (PNG y PDF con el QR `wa.me` y la frase) y muestra el
  enlace para grabar en NFC.
- **AC14** — La ficha del contacto muestra su tarjeta (sellos, canjes,
  último sello, si está en un wallet) con «+ Sumar sello», «Canjear premio»
  y la bitácora.

- **AC15** — Con wallet disponible y sin aceptar, `/c/<token>` muestra la
  casilla y «Aceptar y guardar en mi celular» en vez de los botones.
- **AC16** — Sin la casilla marcada no se registra nada, y sin aceptar
  `/apple` y `/google` responden 303 a la tarjeta.
- **AC17** — `/c/<token>/privacy` dice qué datos, para qué, qué recibe into y
  cómo ejercer los derechos, sin datos del cliente.
- **AC18** — Con el tope lleno, una tarjeta nueva responde 409
  `limit_reached`, por WhatsApp llega la respuesta fija y la IA no contesta. Dos
  altas a la vez no pasan el tope. Quien ya tiene tarjeta sigue igual.

## Qué se decidió NO hacer y por qué

- **Una app aparte**: duplicaría contactos, WhatsApp, instalación y licencia
  (D1).
- **Formulario público de alta con teléfono**: permitiría inventar teléfonos
  y llenar el CRM de basura. Unirse por WhatsApp verifica el número gratis
  (D2).
- **Varios programas a la vez, vencimiento de sellos, niveles o puntos por
  monto**: otra complejidad de modelo. Se pueden agregar sobre las mismas
  tablas.
- **Que el cliente se selle solo con un QR del mostrador**: invita al fraude.
  Sella el equipo (D7).
- **NFC «Smart Tap» de Google o «Value Added Services» de Apple**: piden
  aprobación especial y lectores compatibles. El sticker NFC con el enlace
  cubre el «acerca tu celular» del video.
- **Credenciales de Apple o Google del propio negocio**: inviable para un
  café. Firma into desde el central (D8, enmienda).
- **Avisar cada sello por WhatsApp**: fuera de la ventana cuesta una
  plantilla por mensaje, y el wallet ya avisa gratis (D10).
- **Envíos masivos a los clientes con tarjeta**: es marketing masivo y queda
  fuera por el Principio VIII.

## Pendiente de decidir (Principio VII)

- **Precio (decidido el 2026-11-04)**: Apple y Google Wallet entran en los
  planes Pyme y Empresa. En Emprendedor la tarjeta funciona solo como página
  web. Comunidad no tiene central, así que también queda solo con la página.
  El tope se decidió el 2026-11-05 y cuenta clientes con tarjeta (D12).
- **Spec gemela en into-central**: escrita como
  `into-central/specs/016-wallet-passes` (2026-11-04). Ahí vive el contrato.
- **Privacidad (decidido el 2026-11-05)**: el consentimiento va al guardar la
  tarjeta, no en la respuesta de alta (D13). `NEEDS CLARIFICATION`: revisión
  legal del texto, y que la política de into.center mencione que into firma
  pases de wallet. Decide Juan Carlos.

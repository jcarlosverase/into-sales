# specs/

Especificaciones de Vocero CRM. **Esta carpeta no es el mapa completo del
producto** — y saberlo antes de leerla ahorra una confusión.

## Qué hay aquí

| | Carril | Artefactos |
|---|---|---|
| `001-vocero-core` | Ciclo completo | spec, plan, research, data-model, 5 contratos, tasks, checklist |
| `002-atlas-white-label-design` | — | spec + plan |
| `003-whatsapp-inbox-parity` | — | spec |
| `014-instagram-channel` | Ciclo completo | spec |
| `015-universal-booking-engine` | Ciclo completo | spec, plan, research, data-model, 2 contratos, quickstart, checklist, tasks + la enmienda constitucional que habilitó los conectores |
| `016-capi-attribution` | Ciclo completo | spec, plan, research, data-model, 2 contratos, quickstart, checklist, tasks |
| `017-messenger-channel` | Ciclo completo | spec (sobre los cimientos de 014: mismo adaptador-por-canal y bandera) |
| `018-anuncio-de-origen` | Ciclo completo | spec, plan, data-model, tasks (puerto de la spec 212 de Vocero Cloud; enmienda la captura de 016) |
| `019-resultados` | Ligero | spec (puerto de la pantalla Resultados de Vocero Cloud, sin gasto publicitario ni migración) |
| `020-token-ia-ui` | Ligero, con el modelo de datos dentro | spec (puerto de `ai_credentials` de Vocero Cloud, #85: Ajustes → IA, migración aditiva `0015`, sin registro de llamadas) |
| `021-despacho-estandar` | Ciclo completo | spec, plan, data-model, 1 contrato, tasks (#89: el CRM le despacha cada turno al cerebro; puerto del despachador de Vocero Cloud, migración aditiva `0016`) |
| `022-tiktok-channel` | Ciclo completo | spec, plan, tasks (TikTok por Zernio sobre los cimientos de 014 y 017; migración aditiva `0018`; la ventana y los límites pasan a declararse por canal) |
| `023-channel-settings` | Ligero | spec (pantalla de Instagram, Ajustes → Estado, la cuenta de Zernio resuelta contra la llave, un secreto de firma para todos los canales y el webhook dado de alta por el CRM; puerto de cuatro arreglos de un CRM de cliente, sin migración) |
| `024-social-text-human-window` | Ligero | spec (el texto de la IA sale sin formato en redes; la ventana humana de 7 días de Instagram y Messenger pasa a ser una capacidad del canal con una sola puerta; puerto de dos specs de un CRM de cliente, sin migración) |
| `026-eliminar-conversacion` | Ciclo completo | spec, plan, tasks (eliminar una conversación o el contacto entero y pedirle al cerebro que la olvide; puerto de Vocero Cloud #106; sin migración, enmienda el contrato del 021 con el evento `conversation.deleted`) |
| `025-despacho-recuerda` | Ciclo completo | spec, plan, tasks (el despacho anota qué mensajes debe; puerto de Vocero Cloud #111, #116 y #117, migración aditiva `0017`; enmienda el contrato del 021) |
| `026-reparto-de-leads` | Ciclo completo | spec, plan, data-model, 1 contrato, tasks (IntoSales: vendedor asignado a cada lead, reparto por turno y visibilidad por vendedor; migración aditiva `0017`) |
| `027-datos-de-ejemplo-por-rubro` | Ligero | spec (comandos `seed:academy`, `seed:realestate` y `seed:fashion`; sin migración) |
| `1000-about` | Ligero | spec (pantalla «Acerca de»: versión, módulos encendidos, plan del servicio central, licencia y créditos) |
| `1001-vps-installer` | Ligero | spec (`deploy/install.sh`: instalación y actualización en un comando en un VPS, con varias instancias y el central detrás de un Caddy compartido; `INTO_CENTRAL_URL` en el compose) |
| `1002-lima-database-timezone` | Ciclo completo | spec, plan, tasks (las 83 columnas de fecha pasan a `timestamptz` sin mover ningún instante y la base queda en hora de Lima; la sesión de la app sigue en UTC; migración `0024`) |
| `1003-password-toggle` | Ligero | spec (botón para mostrar u ocultar la contraseña en «Entrar» y «Crear la cuenta inicial»; `components/ui/password-input.tsx`) |
| `1004-health-page` | Ligero | spec («Ajustes → Sistema → Salud»: base de datos, migraciones, archivos, WhatsApp, IA, cerebro externo y servicio central, comprobados al abrirla) |
| `1005-security-scans` | Ligero | spec (pruebas de seguridad en el CI: CodeQL, Gitleaks y `pnpm audit` como SAST; OWASP ZAP baseline contra la imagen en Docker Compose como DAST; guía en `docs/security-scans.md`) |
| `1006-observability` | Ligero | spec (registros JSON con id de pedido, `/api/metrics` con token y alta automática en el monitoreo de into del VPS; gemela de la 009 del central) |
| `031-ai-after-hours` | Ciclo completo | spec, plan, tasks («Cuándo responde la IA»: siempre o solo fuera del horario de atención del equipo, con su horario semanal y zona; el Laboratorio lo ignora; migración aditiva `0022`) |
| `030-import-contacts` | Ciclo completo | spec, plan, tasks (Contactos → «Importar» desde `.xlsx` o CSV con vista previa, código de país, sin duplicar ni pisar, leads por turno; sin migración ni dependencias nuevas) |
| `029-who-to-call-today` | Ciclo completo | spec, plan, tasks (pantalla «Hoy»: seguimientos vencidos, de hoy y leads sin primer contacto, por vendedor; próximo contacto en el cajón del trato; migración aditiva `0021`) |
| `028-central-heartbeat` | Ciclo completo | spec, plan, data-model, tasks y la enmienda 1.5.0 de la constitución (latido al servicio central de into tras la bandera `INTO_CENTRAL_URL`, plan en Ajustes; migración aditiva `0020`) |

**Numeración desde la 1000 (2026-10-15, decisión de Juan Carlos).** Las specs
nuevas de IntoSales se numeran desde la `1000` (`1000-about`, `1001-…`)
para no chocar con la numeración del repositorio original de Vocero, del que
este se alimenta (sus ramas ya usan 028, 029 y 030). Las que ya existían
conservan su número. Desde el 2026-10-16 el nombre de la carpeta va en
inglés (`1003-whatsapp-…`); el contenido sigue en español.

Los tres carriles —ciclo completo, ligero y exento— están definidos en el
[Principio VI de la constitución](../.specify/memory/constitution.md). El
criterio no es el tamaño de la feature: es si toca el **modelo de datos** o un
**contrato publicado**.

Lo que se ve arriba es esa gradación en la práctica, antes de que estuviera
escrita: `001` era el producto entero y llevó el ciclo completo; los siguientes
fueron acotándose.

## Dónde está el resto

Entre `003` y la versión 1.2.0 de la app entraron doce features con
comportamiento observable —la API de servicio para un cerebro externo, bitácora
de etapas, alta manual de prospectos, monto, prioridad, ficha del lead, tema
oscuro, responsividad, plantillas multivariable, envío instantáneo, icono de la
pestaña y versión visible— **sin spec en esta carpeta**. Se implementaron antes
de que el Principio VI tuviera un carril intermedio, y esa es la razón, no una
excusa.

Su comportamiento sí está especificado, en dos sitios mejores que un documento
escrito a posteriori:

- **[`tests/e2e/`](../tests/e2e/)** — el comportamiento observable, con sus
  criterios de aceptación. A diferencia de un spec, estos guiones **se
  ejecutan**: cada uno tiene su `scripts/e2e-*.mjs` o se conduce con Playwright.
  Si el código deja de cumplirlos, se pone rojo.
- **El historial de PRs** — el problema que resolvía cada feature, las
  decisiones de diseño con su motivo, y qué se descartó y por qué.

No se van a escribir specs retroactivos para esas trece. Serían una cuarta copia
de algo ya documentado, y la única que nadie ejecuta: la que envejece hasta
contradecir a las otras tres, con el agravante de estar en la carpeta donde uno
espera encontrar la verdad.

## De aquí en adelante

Toda feature declara su carril **antes** de escribir código y deja su `spec.md`
aquí, ciclo completo o ligero. Un spec escrito después de implementar se marca
como tal en su encabezado: es documentación, no diseño, y confundirlos hace
creer dentro de un año que esas decisiones se tomaron antes de programar.

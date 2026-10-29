# 1013 — Quitar el nombre «Vocero» de lo que es IntoSales

**Created**: 2026-10-29

**Status**: Especificada antes de escribir código. Implementada el
2026-10-29; typecheck, lint y las pruebas tocadas en verde (suite completa y
E2E pendientes, los corre Juan Carlos antes de subir).

**Input**: Juan Carlos el 2026-10-29: «veo que en código sigue diciendo
vocero» y «crea la spec 1013».

**Carril**: ligero. Textos, nombres internos y tres nombres de contrato con
compatibilidad hacia atrás; sin migración de base de datos ni dependencias
nuevas.

## Problema

IntoSales nació de Vocero CRM (MIT, Kevin Belier). La spec 1001 y el commit
«Replace vocero» quitaron el nombre de lo que se instala (base, volúmenes,
usuario del contenedor, entrypoint), pero quedan 443 menciones en 151
archivos. Algunas se ven en pantalla («El webhook lo da de alta Vocero en tu
Zernio…»), otras viajan a sistemas externos (cabeceras `x-vocero-*`) y otras
son créditos o historia que hay que conservar. Hoy no hay un criterio escrito
de cuál es cuál, y cada cambio las mezcla.

## Criterio

| Grupo | Qué es | Se hace |
|---|---|---|
| G1 | Texto que ve el usuario | «Vocero» → «IntoSales» |
| G2 | Nombres internos (globales del proceso, claves del navegador, cookie del tema) | Renombrar con prefijo `intosales`; la cookie y las claves del navegador migran el valor viejo |
| G3 | Comentarios que nombran a Vocero como el producto actual | «Vocero» → «IntoSales» |
| G4 | Nombres de contrato con sistemas externos | Renombrar con compatibilidad hacia atrás (ver AC4) |
| G5 | Créditos, origen e historia | Se quedan |

## Comportamiento observable y criterios de aceptación

- **AC1 (G1)** — Ninguna pantalla, aviso, texto de ayuda o salida de comando
  dice «Vocero». En particular: Ajustes → Canales, Messenger, Instagram, TikTok
  y la conexión de Zernio; el ejemplo de URL de la tarjeta del cerebro y de
  `pnpm doctor` (`…/vocero/dispatch` → `…/intosales/dispatch`); el título de
  `pnpm doctor`; los nombres del simulador de Meta en desarrollo («App de
  prueba IntoSales», «Página de prueba IntoSales», «Número de prueba
  IntoSales»).
- **AC2 (G2)** — Las globales del proceso (`__voceroAuth`, `__voceroSql`,
  `__voceroBus`, `__voceroRateLimit`, `__voceroDispatchWorker`,
  `__voceroMediaDirProbe`, `__voceroBotLastSeen`, `__voceroBrainHealth`,
  `__voceroInternalSignup`, `__voceroZernioWebhooks` y las de los
  simuladores) pasan a `__intosales*`.
- **AC3 (G2)** — La cookie del tema pasa a `intosales-theme` y las claves del
  navegador a `intosales.panelOpen` e `intosales:citas:*`. Si solo existe la
  vieja, se lee y se reescribe con el nombre nuevo: nadie pierde su tema ni
  sus vistas.
- **AC4 (G4)** — Contratos:
  - **Despacho al cerebro externo** (spec 021): el CRM envía solo las
    cabeceras nuevas `x-intosales-signature`, `x-intosales-dispatch-id`,
    `x-intosales-organization` y `x-intosales-event`, con los mismos valores
    que las `x-vocero-*` de antes. No hay cerebro externo en uso (decisión de
    Juan Carlos, 2026-10-29), así que no se mandan las dos. El contrato
    `specs/021-standard-dispatch/contracts/dispatch.md` anota el cambio de
    nombre.
  - **Webhook en Zernio**: se da de alta con el nombre `intosales-<dominio>`.
    El CRM ya reconoce el suyo por la URL (`pointsHere`), no por el nombre, así
    que uno viejo `vocero-<dominio>` sigue reconocido y no se duplica.
  - **Conversions API de Meta**: `partner_agent` pasa de `vocero-crm` a
    `intosales`. Es solo una etiqueta de origen; Meta no la valida.
- **AC5 (G3)** — Los comentarios que hablan de Vocero como el producto actual
  («quien instala Vocero…», «lo que Vocero usa de Zernio…») dicen IntoSales.
- **AC6 (G5)** — Se conservan sin cambios:
  - los créditos que exige la licencia MIT: `LICENSE`, la pantalla «Acerca
    de» (enlace a Vocero CRM), `package.json` («Basado en Vocero CRM») y la
    sección de créditos del README;
  - las referencias de origen en comentarios («puerto de … de Vocero
    Cloud», «basado en el sistema de Vocero CRM»);
  - la historia: entradas ya publicadas del `CHANGELOG.md`, specs anteriores a
    esta, `docs/worklog-2.0.md`, `docs/plan-1.5-and-2.0.md` y los nombres de
    carpetas viejas como `specs/001-vocero-core`;
  - la migración del instalador que renombra la base `vocero` y los volúmenes
    `vocero_*` de instalaciones antiguas (`deploy/install.sh`), y el mensaje de
    `pnpm doctor` que la explica;
  - las pruebas que verifican que no quede «vocero» en lo que se instala
    (`tests/unit/installer.test.ts`).
- **AC7** — Una prueba recorre `src/` y falla si aparece «vocero» fuera de una
  lista corta de excepciones permitidas (créditos, cabeceras obsoletas de AC4,
  claves viejas de AC3 y la migración del doctor), para que no vuelva a
  entrar.
- **AC8** — Los datos de prueba (`e2e@vocero.test`, `capturas@vocero.test`,
  carpetas temporales `vocero-*`) pasan a `intosales.test` / `intosales-*`.
  Los guiones E2E y las pruebas unitarias se ajustan a los nombres nuevos.

## Qué se decidió NO hacer y por qué

- **No se reescribe la historia**: cambiar «Vocero» por «IntoSales» en specs,
  CHANGELOG o worklogs ya escritos haría que dijeran algo que no pasó y
  borraría de dónde viene cada pieza.
- **No se quitan los créditos**: la licencia MIT de Vocero CRM exige conservar
  su aviso de copyright.
- **No se renombra la carpeta `specs/001-vocero-core`** ni las de otras specs
  viejas: los enlaces desde código, docs y commits apuntan a ellas.

## Decisiones

- **2026-10-29** — Juan Carlos: «no uso cerebro externo». Las cabeceras del
  despacho pasan directo a `x-intosales-*`, sin enviar también las viejas.
- La documentación vigente (README, AGENTS.md, CLAUDE.md, INSTALL-AI.md,
  `docs/capi-attribution.md`, `.env.example`) también dice IntoSales, salvo los
  créditos. INSTALL-AI.md tenía además la base `vocero` de antes de la spec
  1001: ahora dice `into_sales`.

## Dónde vive

Textos en `src/components/settings/` y `src/components/agent/brain-status-card.tsx`
· `scripts/doctor.ts` y `src/server/doctor/checks.ts` · simuladores en
`src/app/api/dev/` y `src/server/dev/` · globales en `src/lib/` y `src/server/`
· tema en `src/lib/theme.ts` · claves del navegador en
`src/components/inbox/inbox-client.tsx` y `src/components/bookings/bookings-client.tsx`
· cabeceras en `src/server/brains/contract.ts` y `deliver.ts` · Zernio en
`src/server/zernio/connections.ts` · CAPI en `src/lib/meta/capi.ts` · prueba
nueva en `tests/unit/no-vocero.test.ts` · migración de cookie y claves en
`src/lib/theme.ts` (`themeCookieValue`) y `src/lib/local-prefs.ts`, con su
prueba en `tests/unit/legacy-prefs.test.ts`.

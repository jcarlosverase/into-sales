# Tareas — 028 Latido al servicio central

Spec: [spec.md](spec.md) · Plan: [plan.md](plan.md) · Datos:
[data-model.md](data-model.md).

## Gobierno

- [x] T001 Enmienda 1.5.0 de la constitución (Principios II y VIII) con su Sync Impact Report; propuesta en [constitution-amendment.md](constitution-amendment.md)
- [x] T002 `CLAUDE.md`, `AGENTS.md` y `specs/README.md`: la regla enmendada y la fila de la 028

## Datos

- [x] T003 `central_license` en `src/lib/db/schema.ts`, prefijo `clic` en `ids.ts`, migración `0020_licencia_central`

## Servidor

- [x] T004 `src/server/central/flag.ts`: bandera `INTO_CENTRAL_URL` (D1), declarada en `lib/env.ts` y `.env.example`
- [x] T005 `src/server/central/client.ts`: adaptador del contrato, 10 s, resultados (D4–D6), sin la llave en errores
- [x] T006 `src/server/central/license.ts`: guardar cifrada, vista pública, quitar, anotar resultado
- [x] T007 `src/server/central/checks.ts`: los cinco chequeos (D3)
- [x] T008 `src/server/central/heartbeat.ts`: `latirAhora` y el temporizador (D5); arranque en `instrumentation-node.ts`
- [x] T009 `GET/PUT/DELETE /api/settings/central` con `canConfigure` y 404 sin bandera
- [x] T010 `/api/health` → `features.central`; doctor «Servicio central (opcional)»
- [x] T011 Mock `src/app/api/dev/central-mock/v1/heartbeat`

## Interfaz

- [x] T012 Ajustes → Negocio → «Plan» (`/settings/central`) y su enlace solo con la bandera

## Pruebas

- [x] T013 Unitarias de bandera, adaptador, chequeos, intervalo y vista pública
- [x] T014 `centralChecks` en `scripts/e2e-selftest.mjs` y `tests/e2e/us-central-heartbeat.md`
- [x] T015 CI: la configuración `completo` enciende `INTO_CENTRAL_URL`
- [x] T016 Prueba en vivo con into-central local: el cliente aparece vivo en su panel

# Tareas — 1029 Agenda con profesionales o recursos

Spec: [spec.md](spec.md) · Plan: [plan.md](plan.md) · Datos:
[data-model.md](data-model.md) · Contrato: [contracts/agenda.md](contracts/agenda.md).

`[P]` se puede hacer en paralelo. Cada corte cierra con typecheck, lint, pruebas y los
E2E de agenda en verde.

## Corte 0 — Cita a mano (H0)

- [x] T041 `src/components/bookings/slot-picker.tsx`, extraído del panel de reprogramar
- [x] T042 `src/components/bookings/new-booking-dialog.tsx` y «Nueva cita» en `calendar-toolbar.tsx` (AC29–AC31, AC34, AC35)
- [x] T043 `contactConversationId` en `src/server/agenda/service.ts` y `POST /api/bookings`, con `tests/integration/manual-booking.test.ts` (AC33)
- [x] T044 Flujo en `scripts/e2e-calendar.mjs` y `tests/e2e/us-calendar.md` (AC30, AC32, AC33)

## Corte 1 — Datos y motor (H2, H5)

- [x] T001 Tabla, columnas e índices en `src/lib/db/schema.ts`; prefijo `res_` en `src/lib/db/ids.ts`
- [x] T002 `drizzle/0032_agenda_resources.sql` a mano y re-ejecutable, con journal y snapshot (AC28)
- [x] T003 Prueba de migración: dos veces seguidas, con citas existentes, sin cambiar filas (AC28)
- [x] T004 [P] `src/lib/agenda-resources.ts`: esquema, `pickResource`, `offerMatches`, con unit tests
- [x] T005 `buildCandidateSlots` con `weeklyHours` explícito y `computeResourceAvailability`, con unit tests (AC3, AC8, AC10)
- [x] T006 `findSlot` con `resourceId`; cero profesionales sigue el camino de hoy (AC26)
- [x] T007 Transacción con candado en `createSessionBooking`, `createBlock` y `rescheduleBooking`; entrega fuera (D2). `markBookingStatus` no lo necesita: el índice cubre reactivar una cita
- [x] T008 Integración: carrera con misma persona y con personas distintas (AC6, AC7, SC-001)
- [x] T009 Integración: bloqueo general y por persona, cita sin profesional, Laboratorio (AC8–AC11)
- [x] T010 `src/app/api/calendar/availability`: `resourceId` y `resourceIds`, con 404 por bandera (AC27)
- [x] T011 `GET` y `POST /api/bookings` y `PATCH /api/bookings/:id` con `resourceId`; aislamiento por organización
- [x] T012 Correr `e2e-selftest` y `e2e-calendar` sin cambios (SC-002)

## Corte 2 — Ajustes (H1)

- [x] T013 `src/server/agenda/resources.ts`: crear, editar, ordenar y archivar, con integración (AC1, AC2, AC5)
- [x] T014 Adopción de citas futuras al crear el primero, en una transacción, con integración (AC4)
- [x] T015 `src/app/api/calendar/resources/**`, con permisos y bandera (AC1, AC27)
- [x] T016 `agentResourceMode` en `src/server/agenda/settings.ts` y `PUT /api/calendar/settings`
- [x] T017 [P] Extraer `weekly-hours-editor.tsx` de `agenda-client.tsx`, sin cambiar lo que se ve
- [x] T018 `src/components/settings/agenda-resources.tsx`: lista, alta, edición, orden y archivar, a 360 px (AC1, AC5, AC17)
- [x] T019 Selector del modo del agente, visible con 2 o más (AC18)

## Corte 3 — Citas (H3)

- [x] T020 `slot-picker.tsx` con `resourceId` (AC12)
- [x] T021 «Con quién atiende» en `new-booking-dialog.tsx`, con los tres casos (AC12, AC13)
- [x] T022 «Bloquear horario» con todo el negocio o una persona (AC16)
- [x] T023 Filtro por profesional en `calendar-toolbar.tsx`, guardado en la dirección (AC14)
- [x] T024 Nombre del profesional en rejilla, mes, lista y detalle: `booking-look.ts` y `booking-drawer.tsx` (AC14)
- [x] T025 Mover conservando o cambiando al profesional (AC15)
- [x] T026 Revisión a 360 px de toda la pantalla, sin desborde (AC17)

## Corte 4 — Agente (H4)

- [x] T027 `resource_id` en `src/server/agenda/offers.ts`, `findOffered` y `slotsMapForModel`, con unit tests (AC22)
- [x] T028 `offerSlots`: pregunta del motor, oferta por persona y `any` (AC19–AC21)
- [x] T029 `bookSlot`: asignar, rechazar y confirmar con el nombre (AC21–AC23)
- [x] T030 `slot_taken` con alternativas de la misma persona, o de las demás si no quedan (AC25)
- [x] T031 `src/server/ai/actions.ts`, `prompts.ts` y `pipeline.ts`: `resourceId` y la lista de profesionales
- [x] T032 `src/server/dev/ai-mock.ts`: los dos modos, sin duplicar la cabecera de huecos
- [x] T033 `/api/bot/availability` y `/api/bot/bookings` según el contrato (AC24)
- [x] T034 `src/server/agenda/context.ts` y `/api/bot/context` con el profesional (AC24)

## Corte 5 — Cierre

- [x] T035 `scripts/e2e-agenda-resources.mjs` y `tests/e2e/us-agenda-resources.md`, a 1280 y 360 px
- [x] T036 Sumarlo a `.github/workflows/e2e.yml`: `completo` y el 404 en `default` (AC27)
- [x] T037 Medir SC-004 con 20 profesionales
- [x] T038 [P] Nota en la spec 015, `specs/README.md`, `CHANGELOG.md`, mapa de `CLAUDE.md` y `AGENTS.md`
- [x] T039 [P] Datos de ejemplo: 10 profesionales en `src/server/seed/industries/dental.ts` (2026-11-07, pedido de Juan Carlos; spec 023, D14 a D16)
- [ ] T040 Verificación humana: clínica de dos doctores en un CRM real, por WhatsApp (Constitución IX)

## Notas de la implementación (2026-11-06)

- `slotsMapForModel` no cambió: la oferta ya sabe con quién (T027).
- Tras la revisión: el horario del negocio limita el de cada persona y «Primero libre» es
  al azar.
- Los E2E de agenda y calendario pasan sin cambios. Solo se ajustaron pruebas unitarias
  que simulan la base: ahora conocen la transacción y el módulo de profesionales.

## Dependencias

- El corte 1 va primero. T005 antes que T006, y T006 antes que T007.
- Los cortes 2 y 3 dependen del 1. El 3 usa lo que crea el 2.
- El corte 4 depende del 1 y necesita el 2 para probarse de punta a punta.
- T035 cierra todo.

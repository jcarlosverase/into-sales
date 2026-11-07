# Plan — 1029 Agenda con profesionales o recursos

Spec: [spec.md](spec.md) · Datos: [data-model.md](data-model.md) · Contrato:
[contracts/agenda.md](contracts/agenda.md) · Tareas: [tasks.md](tasks.md).

## Resumen

La agenda pasa de un calendario por negocio a uno por profesional, sin cambiar nada a
quien no los use. El punto de quiebre es una función: `computeAvailability` recibe a
quién mirar, y todo lo demás (reservas, oferta, agente, pantallas) se apoya en ella.

## Contexto técnico

Next.js 15 y TypeScript, Drizzle sobre PostgreSQL 16, Vitest, E2E con Playwright. No
se agrega ninguna dependencia.

## Revisión contra la Constitución

| Principio | Cómo se cumple |
|---|---|
| II Soberanía | Sin terceros nuevos; la bandera `AGENDA` sigue mandando |
| III Multi-tenancy | Toda consulta usa `scoped()`; un `resourceId` ajeno responde 404 |
| V Calidad | Unit, integración contra PostgreSQL real y E2E por corte |
| VI Specs antes de código | Este paquete, revisado antes de empezar |
| VIII Foco vertical | Es el agendamiento que ya existe, para negocios con más de una persona |
| IX Verificación en vivo | Guion E2E y conversación real antes de cerrar |

No hace falta enmendar la Constitución. Sí cambia una suposición escrita de la 015
(«Un negocio = una agenda»), que hay que anotar allí.

## Decisiones

### D1 — Dos índices únicos parciales

Hay que garantizar una cita por instante y por persona, y seguir igual sin personas.
PostgreSQL trata los null como distintos, así que un solo índice sobre `resource_id` no
sirve. `NULLS NOT DISTINCT` existe desde la versión 15, pero dos parciales dejan el
índice de hoy casi intacto y se leen mejor. Una restricción `EXCLUDE` cubriría solapes,
pero exige la extensión `btree_gist` y privilegios que una instalación puede no tener.

### D2 — Candado de la organización al confirmar

Un índice por persona ya no ve el choque entre un bloqueo general y una cita con
profesional. Revalidar e insertar pasa a una transacción con
`pg_advisory_xact_lock(hashtext('agenda:' || organization_id))`. El índice sigue siendo
la última defensa. El candado es por organización y no por persona porque un bloqueo
general toca a todos, y el volumen de citas de un negocio lo permite. La entrega de la
reunión queda fuera de la transacción: un proveedor lento no debe retener el candado.

### D3 — Disponibilidad por persona, con la función pura intacta

`buildCandidateSlots` recibe `weeklyHours` explícito en lugar de leerlo de `settings`, y
`filterFreeSlots` no cambia. `intersectWeeklyHours` recorta el horario de cada persona al
del negocio al calcular, no al guardar: si el negocio cambia, se ajusta solo. Una función nueva, `computeResourceAvailability`, lee una
vez las citas del rango y por cada persona resta las suyas y las de `resource_id` null.
La unión se ordena y deja un hueco por instante, con `resourceIds`. Sin personas,
`computeAvailability` sigue el camino de hoy.

### D4 — Elegir quién atiende en un solo lugar

`pickResource(freeIds, resources, random)`, pura: uno al azar entre quienes están libres
en ese instante. Recibe el azar para poder probarla.
La usa `createSessionBooking`, por donde pasan el panel, el bot y el agente.

### D5 — La oferta recuerda a la persona

`findOffered` compara el instante y luego el profesional, con la tabla del contrato.
Sigue sin tolerancias: así un modelo no puede cambiar de doctor por su cuenta.

### D6 — El motor hace la pregunta

Igual que los horarios, los nombres no los redacta el modelo. `offerSlots` responde con
«¿Con quién prefieres atenderte: Dra. Ana o Dr. Luis?», o «¿Qué sala prefieres?» si son
recursos. No registra oferta: aún no hay nada que reservar.

### D7 — El cerebro externo no se rompe

El modo «Preguntar» no devuelve error en `/api/bot/*`: un cerebro antiguo no lo
entendería y dejaría de agendar. Recibe `resourceMode` y `resources` para decidir.

### D8 — Reutilizar las pantallas

`SlotPicker` (H0) recibe `resourceId`. El editor de horario semanal de
`agenda-client.tsx` se extrae para usarlo con el negocio y con cada profesional. La
rejilla ya pinta citas solapadas en carriles, así que no necesita columnas por persona.

## Piezas

| Pieza | Dónde |
|---|---|
| Esquema y migración | `src/lib/db/schema.ts` · `drizzle/0032_agenda_resources.sql` |
| Reglas puras | `src/lib/agenda-resources.ts`: esquema, `pickResource`, `offerMatches` |
| Profesionales | `src/server/agenda/resources.ts`: crear, editar, archivar y adoptar |
| Motor | `availability.ts`, `service.ts`, `offers.ts`, `agent.ts`, `context.ts` |
| API | `src/app/api/calendar/resources/**`, `bookings`, `calendar/availability`, `bot/*` |
| Agente | `src/server/ai/prompts.ts`, `actions.ts`, `pipeline.ts`, `dev/ai-mock.ts` |
| Ajustes | `src/components/settings/agenda-resources.tsx`, `weekly-hours-editor.tsx` |
| Citas | `new-booking-dialog.tsx`, `slot-picker.tsx`, `block-dialog.tsx`, `booking-drawer.tsx`, `calendar-toolbar.tsx`, `booking-look.ts` |
| Pruebas | `tests/unit/agenda-resources*.test.ts`, `tests/integration/agenda-resources*.test.ts`, `scripts/e2e-agenda-resources.mjs`, `tests/e2e/us-agenda-resources.md` |

## Orden

Cinco cortes, y cada uno deja el CRM en verde y desplegable:

1. **Datos y motor.** Sin pantallas. Con cero profesionales todo es igual.
2. **Ajustes.** Ya se pueden crear profesionales, y el motor los respeta.
3. **Citas.** Elegir con quién, filtrar y mover.
4. **Agente.** Modos, oferta con persona y contexto.
5. **Cierre.** E2E completo, documentos y conversación real.

## Pruebas

| Nivel | Qué fija |
|---|---|
| Unit | Disponibilidad por persona, unión sin repetir, `pickResource`, `offerMatches`, normalizar horarios, oferta, pregunta del motor |
| Integración, PostgreSQL real | Migración dos veces con datos, índices, carrera por persona, bloqueo general contra cita, adopción, archivar, aislamiento por organización |
| E2E existentes, sin cambios | `e2e-selftest`, `e2e-calendar`, los dos con cero profesionales |
| E2E nuevo | Ajustes, Citas a 1280 y 360 px, agente en los dos modos, bot, bandera apagada |

El E2E nuevo corre en la configuración `completo` de `.github/workflows/e2e.yml`, y
comprueba el 404 en `default`.

## Riesgos

| Riesgo | Respuesta |
|---|---|
| Recrear el índice deja un instante sin protección | La migración corre en una transacción, y al arrancar |
| Romper a quien no usa profesionales | Corte 1 con los E2E actuales sin tocarlos |
| El modelo no emite `resourceId` | El motor vuelve a preguntar; nunca adivina |
| Con muchos profesionales la oferta se dispara | Una sola lectura de citas por rango; SC-004 lo mide |
| La rejilla se llena en «Todos» | Filtro por persona, y el carril de la rejilla ya existe |

## Resultado de medir

- **SC-001:** 1,000 pares de reservas simultáneas, cero dobles citas.
- **SC-004:** 20 profesionales y 14 días abiertos todo el día, menos de 300 ms.

Medir SC-004 obligó a expandir cada horario una sola vez y a etiquetar una vez por
instante: sin eso tardaba 513 ms.

# Implementation Plan: Reparto de leads por vendedor

**Branch**: `feat/intosales` | **Spec**: [spec.md](spec.md) | **Datos**: [data-model.md](data-model.md) | **Contrato**: [contracts/api.md](contracts/api.md)

## Summary

El lead gana un vendedor asignado. Al crearse, la única puerta que crea leads
(`createLeadForContact`) le pide un vendedor al reparto por turno. Las rutas
de la app resuelven el alcance de quien pregunta (`getLeadScope`) y, si es un
vendedor, filtran por «contactos con lead suyo» con una sola condición SQL
reutilizable. El SSE filtra por suscriptor con la misma regla.

## Technical Context

- **Stack**: Next.js 15, TypeScript estricto, Drizzle + PostgreSQL, Vitest.
- **Dependencias nuevas**: ninguna.
- **Idioma**: código, nombres de tablas, columnas, rutas y comentarios nuevos
  en inglés; textos de la interfaz y documentación en español.
- **Rendimiento**: el filtro del vendedor es un `EXISTS` sobre
  `lead (organization_id, assigned_user_id)`, con índice. El SSE hace una
  consulta por evento solo para suscriptores vendedores.

## Constitution Check

| Principio | Evaluación |
|---|---|
| I · Seguridad | El vendedor no ve datos ajenos ni por URL directa: las rutas de detalle comprueban el alcance y responden 404. |
| II · Soberanía | Sin dependencias ni terceros nuevos. |
| III · Multi-tenancy | Las tablas nuevas llevan `organization_id NOT NULL`; toda consulta sigue pasando por `scoped()`, y el filtro del vendedor se suma, no reemplaza. |
| IV · Idempotencia | El turno se toma con `FOR UPDATE` y el lead se crea con el mismo `onConflictDoNothing` de siempre: si otro webhook ganó la carrera, no se asigna nada dos veces. Migración aditiva. |
| V · Hecho | Unitarias del turno (orden, salto de excluidos, vuelta al inicio, cursor huérfano) y del alcance; gate técnico. |
| VI · Specs | Ciclo completo: migración y cambio de contrato interno. |
| Contratos públicos | `/api/bot/*`, el webhook y la forma de los eventos SSE no cambian. |
| Sandbox | Las conversaciones `is_test` no crean leads de ventas: no cambia nada. |

Sin violaciones.

## Project Structure

```text
src/lib/db/schema.ts                         lead.assigned_user_id/assigned_at, lead_routing, lead_routing_member
src/lib/db/ids.ts                            prefijo lrm_
drizzle/0019_lead_assignment.sql             migración (+ snapshot y journal)
src/lib/auth/roles.ts                        isSupervisor()
src/server/leads/round-robin.ts              pickNextAssignee() puro (testeable)
src/server/leads/routing.ts                  turno con bloqueo, configuración del reparto
src/server/leads/scope.ts                    getLeadScope, visibleContactSql, canSee*()
src/server/inbox/lead-activity.ts            createLeadForContact asigna al crear
src/server/inbox/queries.ts                  listConversations filtra por alcance
src/app/api/conversations/**                 404 a lo ajeno
src/app/api/contacts/**                      filtro y 404; alta manual del vendedor
src/app/api/pipeline/board/route.ts          filtro, assignee, team, canAssign
src/app/api/pipeline/leads/[id]/route.ts     assignedUserId
src/app/api/media/[assetId]/route.ts         404 a lo ajeno
src/app/api/events/route.ts                  SSE filtrado por suscriptor
src/app/api/settings/lead-routing/route.ts   GET/PUT del reparto
src/components/pipeline/*                    iniciales en la tarjeta, selector en el cajón
src/components/settings/team-client.tsx      sección «Reparto de leads»
tests/unit/round-robin.test.ts               turno
tests/unit/lead-scope.test.ts                alcance por rol
```

## Notas de diseño

- **El turno es una función pura** (`pickNextAssignee(candidatos, cursor)`)
  y la transacción solo la envuelve: así el orden se prueba sin base.
- **La asignación va dentro de `createLeadForContact`**, después del insert y
  solo si el insert ganó: un webhook que pierde la carrera no consume turno.
- **`assignedUserId` explícito gana al turno**: la captura manual del vendedor
  lo pasa con su propio id (D6).
- **El SSE no cambia de forma**: se decide por evento si se envía. Para
  `conversation.updated` la conversación se lee por id; el filtro solo corre
  para vendedores.

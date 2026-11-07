# 1029 — Modelo de datos

Migración `0032_agenda_resources`, re-ejecutable y aditiva, salvo por el cambio de un
índice. Fechas con `timestamp(..., { withTimezone: true })` (spec 1002). Se aplica
siempre, como la agenda: una tabla vacía es inerte (ADR-001).

## `agenda_resource` (nueva, `res_`)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | |
| `organization_id` | text FK → organization, cascade | |
| `kind` | text | `person` · `resource`; cambia cómo pregunta el agente |
| `name` | text | 1–60; es lo que lee el cliente |
| `weekly_hours` | jsonb | la forma de `calendar_settings.weekly_hours` |
| `position` | integer | orden en que se muestran |
| `active` | boolean | por defecto `true`; archivar es `false` |
| `created_at`, `updated_at` | timestamptz | |

Índices: `agenda_resource_org_position_idx` (`organization_id`, `position`) y único
parcial `agenda_resource_org_name_uq` (`organization_id`, `lower(name)`) donde `active`.

## `calendar_settings` (cambia)

| Columna | Tipo | Notas |
|---|---|---|
| `agent_resource_mode` | text | `first_free` (por defecto) · `ask` |

## `booking` (cambia)

| Columna | Tipo | Notas |
|---|---|---|
| `resource_id` | text null FK → agenda_resource, **no action** | null: sin profesional |

`no action`, no `set null`: poner en null dos citas del mismo instante chocaría con el
índice de las citas sin profesional. Como no hay borrado, solo aplica al borrar la
organización, y `no action` se revisa al final de la sentencia, después de la cascada.

Índices:

| Índice | Columnas | Condición |
|---|---|---|
| `booking_org_active_slot_uq` (se recrea) | `organization_id`, `scheduled_at` | activa, no de prueba, **`resource_id is null`** |
| `booking_resource_active_slot_uq` (nuevo) | `organization_id`, `resource_id`, `scheduled_at` | activa, no de prueba, `resource_id is not null` |
| `booking_org_resource_when_idx` (nuevo) | `organization_id`, `resource_id`, `scheduled_at` | |

«Activa» sigue siendo `status in ('agendada','realizada')`.

Lo que los índices no cubren: un bloqueo de todo el negocio contra la cita de una
persona, o dos citas que se solapan sin empezar igual. Lo cubre el candado de la
organización ([plan.md](plan.md), D2).

## `offered_slot` (cambia)

| Columna | Tipo | Notas |
|---|---|---|
| `resource_id` | text null FK → agenda_resource, cascade | null: cualquiera libre |

Índice `offered_slot_conv_idx` sin cambios. Comparar sigue siendo por epoch exacto.

## Cómo queda cada caso

| `resource_id` | Significado | A quién ocupa |
|---|---|---|
| null, sin profesionales activos | Cita o bloqueo de hoy | Al negocio |
| null, con profesionales | Bloqueo general o cita antigua | A todos |
| Un id | Cita o bloqueo de esa persona | Solo a esa persona |

## Migración

Cada sentencia se puede repetir:

```sql
CREATE TABLE IF NOT EXISTS "agenda_resource" (...);
CREATE INDEX IF NOT EXISTS ...;
ALTER TABLE "calendar_settings" ADD COLUMN IF NOT EXISTS "agent_resource_mode" text DEFAULT 'first_free' NOT NULL;
ALTER TABLE "booking" ADD COLUMN IF NOT EXISTS "resource_id" text;
ALTER TABLE "offered_slot" ADD COLUMN IF NOT EXISTS "resource_id" text;
DO $$ BEGIN
  ALTER TABLE "booking" ADD CONSTRAINT ... ;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DROP INDEX IF EXISTS "booking_org_active_slot_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "booking_org_active_slot_uq" ...;
CREATE UNIQUE INDEX IF NOT EXISTS "booking_resource_active_slot_uq" ...;
```

No toca filas: todas las citas quedan con `resource_id` null, y cumplen el índice nuevo
porque ya cumplían el anterior. Reversa: quitar los dos índices, recrear el original y
borrar las columnas, solo si no hay dos citas al mismo instante.

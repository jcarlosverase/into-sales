# Modelo de datos — 022 Reparto de leads

Migración aditiva `0019_lead_assignment`. No borra ni reescribe datos: los
leads existentes quedan sin asignar (D9).

## `lead` (columnas nuevas)

| Columna | Tipo | Nulo | Notas |
|---|---|---|---|
| `assigned_user_id` | `text` → `user.id` | sí | Vendedor dueño del lead. `ON DELETE SET NULL` (D10). `NULL` = sin asignar. |
| `assigned_at` | `timestamp` | sí | Cuándo se asignó por última vez. |

Índice nuevo: `lead_org_assignee_idx (organization_id, assigned_user_id)`, el
que usan todas las consultas de visibilidad del vendedor.

## `lead_routing` (tabla nueva)

Una fila por organización. Se crea al primer uso; sin fila, el reparto se
considera encendido (D4).

| Columna | Tipo | Nulo | Notas |
|---|---|---|---|
| `organization_id` | `text` → `organization.id`, PK | no | `ON DELETE CASCADE`. |
| `enabled` | `boolean` | no | Default `true`. |
| `last_assigned_user_id` | `text` | sí | Cursor del turno: el último que recibió un lead. Sin llave foránea a propósito: si ese usuario ya no está, el turno sigue con el siguiente de la lista. |
| `updated_at` | `timestamp` | no | |

El turno se toma con `SELECT … FOR UPDATE` sobre esta fila, dentro de la misma
transacción que escribe el cursor (D3).

## `lead_routing_member` (tabla nueva)

Solo guarda la excepción: un vendedor sin fila **sí** recibe leads.

| Columna | Tipo | Nulo | Notas |
|---|---|---|---|
| `id` | `text` PK | no | Prefijo `lrm_`. |
| `organization_id` | `text` → `organization.id` | no | `ON DELETE CASCADE`. |
| `user_id` | `text` → `user.id` | no | `ON DELETE CASCADE`. |
| `receives_leads` | `boolean` | no | Default `true`. |
| `updated_at` | `timestamp` | no | |

Índice único: `lead_routing_member_org_user_uq (organization_id, user_id)`.

## Quién está en el turno

La lista del turno son los miembros de la organización con
`member.role = 'member'`, ordenados por `member.created_at, member.id`. El
siguiente es el primero después de `last_assigned_user_id` en esa lista que
reciba leads (sin fila en `lead_routing_member` con `receives_leads = false`),
dando la vuelta al llegar al final. Si el cursor ya no está en la lista (ese
usuario salió del equipo), empieza desde el primero.

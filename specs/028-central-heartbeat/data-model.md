# Modelo de datos — 028 Latido al servicio central

Migración aditiva `0020_licencia_central`. Una tabla nueva; nada existente cambia.

Antes hubo que reparar la `0019_lead_assignment` del reparto de leads: el
archivo se había renombrado desde `0017` sin tocar el journal (entrada sin
archivo, `idx` repetido y fecha anterior a `0018`). Ahora va al final con
fecha posterior a `0018`, su SQL es re-ejecutable (las bases que ya la
aplicaron como `0017` la vuelven a ver pendiente y no fallan) y tiene su
`0019_snapshot.json` encadenado a `0018`. `tests/unit/migration-journal.test.ts`
vigila que no vuelva a pasar.

## `central_license`

Una fila por organización con la llave de licencia de into y lo último que
dijo el central.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | prefijo `clic` |
| `organization_id` | text NOT NULL FK → `organization` | `ON DELETE CASCADE`; índice único |
| `key_cipher`, `key_iv`, `key_tag` | text NOT NULL | La llave cifrada (AES-256-GCM, `lib/crypto`) |
| `key_last4` | text NOT NULL | Lo único de la llave que sale hacia fuera |
| `last_attempt_at` | timestamp NULL | Último intento de latido |
| `last_result` | text NULL | `ok`, `llave_invalida`, `limite`, `rechazado` o `sin_respuesta` (check) |
| `last_ok_at` | timestamp NULL | Último latido aceptado |
| `plan_code`, `plan_name` | text NULL | Del último latido aceptado |
| `customer_status` | text NULL | `active` o `suspended` (check), del último latido aceptado |
| `next_heartbeat_seconds` | integer NULL | Lo que pidió el central, sin acotar |
| `created_at`, `updated_at` | timestamp | |

Guardar una llave nueva reemplaza la fila entera (vuelve a vacío lo del último
latido). Quitarla borra la fila.

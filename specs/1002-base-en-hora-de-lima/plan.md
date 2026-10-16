# Plan — 1002 La base en hora de Lima

Spec: [spec.md](spec.md) · Tareas: [tasks.md](tasks.md).

## Datos

Migración `0024_timestamptz_lima`:

1. Para cada una de las 83 columnas:
   `ALTER TABLE t ALTER COLUMN c SET DATA TYPE timestamp with time zone USING c AT TIME ZONE 'UTC'`.
   Los defaults (`now()`) y los índices se conservan; PostgreSQL reconstruye
   los índices que tocan la columna.
2. Un bloque `DO` que corre
   `ALTER DATABASE <current_database()> SET timezone TO 'America/Lima'`,
   con `EXCEPTION WHEN insufficient_privilege` para que la migración avise
   sin fallar.

En el esquema de Drizzle, todas las columnas pasan a
`timestamp(..., { withTimezone: true })`. Así Drizzle deja de agregarle
`+0000` al leer y usa el desfase que trae el valor.

## Piezas

| Pieza | Cambio |
|---|---|
| `src/lib/db/schema.ts` | `withTimezone: true` en las 83 columnas y el comentario del marco de tiempo |
| `src/lib/db/index.ts` | Comentario: por qué la sesión sigue en UTC (D3) |
| `src/server/analytics/shared.ts` | `localDateExpr`: `at time zone tz` |
| `src/server/analytics/hygiene.ts`, `inbox/outbound-cap.ts`, `brains/deliver.ts` | `::timestamptz` |
| `docker-compose.yml`, `docker-compose.dev.yml` | `TZ` y `PGTZ` = `America/Lima` en el servicio `postgres` |

## Pruebas

- Integración (PostgreSQL real), en `tests/integration/timestamptz-lima.test.ts`:
  - todas las columnas de fecha son `timestamptz`;
  - `show timezone` da `America/Lima` en una sesión nueva;
  - un `defaultNow()` queda a segundos de `Date.now()`;
  - un instante escrito desde JS se lee igual.
- La migración contra una copia de la base de desarrollo (con datos): los
  instantes no cambian.
- Toda la suite de integración y los E2E en los dos modos.

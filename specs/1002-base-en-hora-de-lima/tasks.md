# Tareas — 1002 La base en hora de Lima

Spec: [spec.md](spec.md) · Plan: [plan.md](plan.md).

- [x] T001 `withTimezone: true` en `src/lib/db/schema.ts` y comentarios del marco de tiempo
- [x] T002 Migración `0024_timestamptz_lima` (USING … AT TIME ZONE 'UTC' y ALTER DATABASE)
- [x] T003 SQL que suponía `timestamp` sin zona (`localDateExpr`, `::timestamptz`)
- [x] T004 `TZ`/`PGTZ` en el Postgres de los compose
- [x] T005 Integración contra PostgreSQL y la migración sobre una copia con datos
- [x] T006 Gates, E2E en los dos modos, y migrar la base de desarrollo
- [x] T007 `specs/README.md` y `CLAUDE.md`

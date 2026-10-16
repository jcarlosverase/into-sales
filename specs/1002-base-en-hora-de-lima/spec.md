# 1002 — La base de datos en hora de Lima

**Created**: 2026-10-16

**Status**: Especificada antes de escribir código. Implementada. Están en verde
los gates, las pruebas contra PostgreSQL (también la migración sobre una base
con datos y sobre una copia de la de desarrollo) y los E2E. La migración ya
se aplicó a la base de desarrollo.

**Input**: pedido de Juan Carlos el 2026-10-16: «todo el time zone debe ser
America/Lima y UTC-5» y «cambia el time zone en la base de datos».

**Carril**: ciclo completo (Principio VI). Cambia el tipo de las 83 columnas
de fecha y hora con la migración `0024`. Plan en [plan.md](plan.md) y tareas
en [tasks.md](tasks.md).

## Problema

Las columnas de fecha son `timestamp without time zone` y guardan UTC sin
decirlo. Quien abre la base (psql, TablePlus, el panel de Coolify) ve las
14:00 de una cita que en Lima es a las 09:00, y nada le avisa que esa hora
está en UTC. Cambiar solo la zona de la base no lo arregla: una columna sin
zona se muestra igual en cualquier zona.

## Decisiones

**D1 — Las columnas pasan a `timestamptz`.** Cada valor se convierte como lo
que siempre fue, UTC (`USING col AT TIME ZONE 'UTC'`), así que ningún
instante cambia. Desde ese momento la columna guarda un instante absoluto y
cada herramienta lo muestra en la zona de su sesión.

**D2 — La zona por defecto de la base es `America/Lima`.** La migración
corre `ALTER DATABASE <la actual> SET timezone TO 'America/Lima'`. Así,
psql, pg_dump y cualquier sesión que no diga otra cosa ven la hora de Lima
(`-05`). Si el usuario de la base no tiene permiso para cambiarla, la
migración avisa y sigue: es solo presentación. El contenedor de PostgreSQL
del compose también arranca en `America/Lima` (`TZ` y `PGTZ`).

**D3 — La app sigue calculando en UTC.** La conexión de la app conserva
`TimeZone: "UTC"`. Con `timestamptz` ya no es lo que evita el desfase de
`now()`, pero mantiene en UTC los casts y formatos que dependen de la sesión,
como `::date`, `to_char` y el texto sin zona. La zona del negocio se sigue
aplicando a propósito donde corresponde (Resultados, agenda, «Hoy»).

**D4 — El SQL que suponía `timestamp` sin zona se corrige:**
- `localDateExpr` (Resultados) pasa de `at time zone 'UTC' at time zone tz` a
  `at time zone tz`;
- los `::timestamp` pasan a `::timestamptz`.

## Criterios de aceptación

- **AC1** — Tras la migración, las 83 columnas son `timestamp with time zone`
  y ningún instante cambió: una fila guardada a las 14:00 UTC sigue siendo
  las 14:00 UTC, y en Lima se muestra `09:00-05`.
- **AC2** — `show timezone` en una sesión nueva de la base da `America/Lima`.
- **AC3** — `now()` (los `defaultNow()`) y las fechas escritas desde la app
  guardan el mismo instante: no hay desfase de 5 horas entre una burbuja del
  hilo y la lista.
- **AC4** — Resultados agrupa por día del negocio igual que antes, con
  higiene y cortes incluidos, y el resto de la app no cambia de
  comportamiento: pruebas unitarias, de integración y E2E en verde.
- **AC5** — La migración corre igual sobre una base nueva y sobre una con
  datos, y si se vuelve a correr no hace nada (Principio IV).

## Qué se decidió NO hacer y por qué

- **Poner la sesión de la app en Lima**: no aporta nada visible y expone a
  desfases cualquier cast que dependa de la sesión (D3).
- **Guardar la hora de pared de Lima sin zona**: sería repetir el problema,
  ahora con otra zona.

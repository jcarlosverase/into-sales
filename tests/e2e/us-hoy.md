# Guion E2E · A quién llamar hoy (spec 029)

Automatizado en `scripts/e2e-selftest.mjs` (`todayChecks`). El operador del
arnés es el dueño (supervisor). La lista por vendedor y las reglas de cada
sección se prueban contra PostgreSQL en `tests/integration/today.test.ts`.

1. `GET /api/today` trae las tres secciones (Vencidos, Para hoy, Sin primer
   contacto) en el día del negocio, y al supervisor le deja elegir vendedor.
2. Dos WhatsApp nuevos (wa-mock) quedan en «Sin primer contacto». Al contestar
   uno desde la Bandeja, ese sale de ahí (AC4).
3. El `PATCH` del lead rechaza `followUpOn: "2026-02-30"` con 422 y acepta hoy
   con una nota (AC1); el lead pasa a «Para hoy» y el tablero trae la fecha
   para el cajón.
4. En el teléfono (360 px), «Hoy» muestra el lead con su nota y sin scroll
   horizontal; «Hecho» → «Mañana» lo saca de la lista y deja la fecha en
   mañana con la nota; «Sin fecha» la quita (AC6, AC7).

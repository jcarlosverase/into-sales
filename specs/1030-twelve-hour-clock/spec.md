# 1030 — Horas de las citas en am/pm

**Created**: 2026-11-06

**Status**: Implementada; pruebas en verde.

**Input**: Juan Carlos el 2026-11-06: el horario de las citas debe estar en am/pm.

**Carril**: ligero. Sin migración.

## Comportamiento y criterios de aceptación

- **AC1** — Citas muestra las horas en 12 horas en Día, Semana, Mes, Lista, el detalle y
  los huecos para elegir: «3:00 p. m.».
- **AC2** — Lo que lee el cliente también: los horarios que ofrece el agente, sus
  confirmaciones y las etiquetas (`label`) que recibe un cerebro externo.
- **AC3** — Los datos no cambian: el campo `time` de la API y los instantes siguen en 24
  horas, y no se rompe ningún cliente que los lea.

## Fuera de alcance

Los campos de hora de Ajustes y de «Bloquear horario» son `input type="time"`: los
pinta el navegador según su idioma.

## Dónde vive

`time12` en `src/lib/time/slots.ts` · `clock12` y `hourLabel` en
`src/lib/time/calendar.ts` · `src/components/bookings/`

# 1007 — El sol peruano como moneda por defecto

**Created**: 2026-10-25

**Status**: Implementada; pruebas unitarias de `money` y typecheck en verde.

**Input**: pedido de Juan Carlos el 2026-10-25: en Ajustes → Marca, la moneda
del negocio por defecto debe ser PEN.

**Carril**: ligero. Cambia una constante; sin migración.

## Problema

IntoSales se instala para negocios en Perú, pero un negocio que todavía no
eligió su moneda veía y sumaba sus montos en pesos mexicanos (`MXN`), herencia
de Vocero.

## Comportamiento observable y criterios de aceptación

- **AC1** — En una instancia donde nadie guardó la marca, Ajustes → Marca
  muestra «Sol» (PEN) seleccionada en «Moneda del negocio».
- **AC2** — Mientras no se guarde otra, el tablero, el cajón del trato y
  Resultados muestran y suman en soles, y un monto nuevo se guarda con `PEN`.
- **AC3** — El tablero, antes de cargar la moneda del servidor, parte de la
  misma predeterminada (`DEFAULT_CURRENCY`), no de un `MXN` escrito a mano.

## Qué se decidió NO hacer y por qué

- **No se migran datos.** Un negocio que ya guardó su moneda la conserva, y
  los montos ya capturados mantienen la moneda con la que se guardaron: cambiar
  una moneda guardada sin tipo de cambio sería mentir en los totales.
- **El formato de los números (`es-MX`) no cambia**: el pedido es la moneda,
  no la presentación.

## Dónde vive

`src/lib/money.ts` (`DEFAULT_CURRENCY`) · `src/components/pipeline/pipeline-client.tsx`
· prueba en `tests/unit/money.test.ts`.

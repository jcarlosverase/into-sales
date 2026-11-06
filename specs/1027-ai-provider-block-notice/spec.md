# 1027 — Aviso cuando el proveedor de IA frena al agente

**Created**: 2026-11-06

**Status**: Implementada; pruebas contra PostgreSQL y self-test en verde.

**Input**: Juan Carlos el 2026-11-06: aplicar «que el CRM avise cuando el
proveedor responda 403».

**Carril**: ligero, con una migración aditiva (`0031`: dos columnas).

## Problema

El CRM solo pausa la llave con un 401 o un 402. Un 403 (el presupuesto de un
guardrail de OpenRouter, una cuenta suspendida en el central) o el 429 de cupo
agotado del central no pausaban ni avisaban: el agente dejaba de contestar y
por fuera se veía como un bot roto.

## Comportamiento y criterios de aceptación

- **AC1** — Un 403 del proveedor, o un 429 con `quota_exceeded`, deja anotado
  el freno. Un 429 común (ráfaga) no.
- **AC2** — Con el agente encendido, la franja de arriba lo dice y Salud lo
  marca en falla.
- **AC3** — No pausa la llave: se arregla del lado del proveedor. La siguiente
  respuesta buena quita el aviso sola, sin pulsar nada.
- **AC4** — No se reintenta ese turno: reintentar no ayuda.
- **AC5** — «Probar conexión» o guardar otra llave también lo limpian.

## Qué se decidió NO hacer y por qué

- **Pausar con el 403**: obligaría a pulsar «Probar conexión» cada vez que el
  límite se reinicia o into suma cupo.
- **Avisar con la llave del entorno**: no hay fila donde anotarlo; queda en el
  registro, como los demás errores de esa llave.

## Dónde vive

`src/server/ai/credentials.ts` (`blockFromResponse`) · `src/lib/ai/index.ts` ·
`src/lib/ai/provider.ts` (`blockedMessage`) · `src/server/ai/notice.ts` ·
`src/server/system-health.ts` · `drizzle/0031_ai_block_notice.sql` · pruebas en
`tests/unit/ai-config.test.ts` y `tests/integration/ai-block.test.ts`.

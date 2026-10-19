# 1006 — Registros y monitoreo

**Created**: 2026-10-17

**Status**: Especificada antes de escribir código. Implementada; pruebas
unitarias en verde. Es la gemela de la spec 009 de into-central, que trae el
stack de monitoreo del VPS (Prometheus, Loki, Alloy y Grafana).

**Input**: pedido de Juan Carlos el 2026-10-17: «agrega logging y monitoring a
las aplicaciones».

**Carril**: ligero. No toca datos ni contratos: cambia el formato de los
registros y agrega una ruta de métricas protegida.

## Problema

Los registros del CRM son texto suelto en `docker logs`: no se pueden filtrar
por gravedad, buscar días después ni unir con el pedido que los causó. Y nada
dice cuántos webhooks entran, cuánto tarda el agente en contestar o si el
latido al central está fallando, salvo mirando una por una las pantallas.

## Comportamiento observable y criterios de aceptación

- **AC1** — Cada línea del registro del servidor es un JSON con `level` (en
  palabra), `time` (ISO), `service: "into-sales"`, `version` y `msg`. Todo lo
  que se escribía por `console` (el CRM, Next y las librerías) sale así, con el
  error en `err` (mensaje y stack). `LOG_LEVEL` cambia el nivel (por defecto
  `info`).
- **AC2** — Ningún registro trae secretos: las claves `authorization`,
  `cookie`, `password`, `token`, `apiKey`, `secret` y `pepper` salen como
  `[redacted]`. En el registro de Caddy no aparecen el token de la URL de los
  webhooks ni ninguna query string (ahí van el `hub.verify_token` de Meta y los
  tokens de restablecer contraseña); `Authorization` y `Cookie` ya los oculta
  Caddy.
- **AC3** — Cada pedido lleva un `X-Request-Id` (el de Caddy o uno nuevo), que
  la app devuelve en la respuesta y escribe en los errores no controlados.
- **AC4** — Todo error no controlado de una página, ruta o acción, incluidos
  los 500 de las rutas de la API interna, queda como una línea `error` con su
  `requestId` y suma en `into_sales_request_errors_total`. La ruta va sin
  query y sin el token de los webhooks.
- **AC5** — `GET /api/metrics` responde en formato Prometheus solo con
  `Authorization: Bearer <METRICS_TOKEN>`; sin token configurado o con uno
  equivocado, 404. Caddy también responde 404 en el dominio público.
- **AC6** — Las métricas son memoria, CPU y event loop del proceso, más:
  webhooks por canal y resultado (aceptado, token inválido, firma inválida),
  turnos del agente por resultado y su duración, latidos al central por
  resultado y la versión. Solo conteos y tiempos: ningún teléfono, nombre ni
  mensaje.
- **AC7** — Los contenedores de `docker-compose.yml` y el Caddy compartido
  rotan sus registros: 3 archivos de 10 MB como máximo.
- **AC8** — Si el VPS tiene el monitoreo de into (`/opt/into-monitoring`, lo
  instala el instalador del central con `--monitoring`), el instalador del CRM
  copia el token a su `.env` y deja su archivo en `targets/`, así Prometheus la
  lee sin más pasos. Sin monitoreo, no cambia nada.

## Qué se decidió NO hacer y por qué

- **Reescribir cada `console.*` del código**: se enrutan todos al logger en un
  solo lugar al arrancar. El texto de los mensajes queda como estaba.
- **Unir cada línea con su pedido** (AsyncLocalStorage): Next no da un punto
  de entrada por pedido en el runtime de Node. El `requestId` va en los
  errores, y los registros de Caddy dan el resto.
- **Métricas HTTP dentro de la app**: salen de los registros JSON de Caddy, en
  el tablero de Grafana.
- **Instalar el monitoreo desde este instalador**: es uno por servidor para
  todas las apps, y lo instala el del central.

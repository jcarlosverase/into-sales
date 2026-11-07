#!/usr/bin/env bash
# Arranca `next dev` para el E2E, o lo reinicia si ya corría. Lo usa el workflow
# antes de cada guion: `next dev` acumula memoria con cada ruta que compila y, al
# llegar al 80 % de su tope, se reinicia solo en medio de un guion. Eso corta las
# conexiones y borra lo que los mocks guardan en memoria.
set -euo pipefail

PORT="${E2E_APP_PORT:-3000}"
export NODE_OPTIONS="--max-old-space-size=${E2E_APP_HEAP_MB:-12288}"

lsof -tiTCP:"$PORT" -sTCP:LISTEN | xargs -r kill 2>/dev/null || true
for _ in $(seq 1 20); do
  lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
  sleep 0.5
done

nohup node_modules/.bin/next dev --port "$PORT" >> app.log 2>&1 &

for _ in $(seq 1 90); do
  curl -sf "localhost:$PORT/api/health" > /dev/null && exit 0
  sleep 2
done
tail -50 app.log
exit 1

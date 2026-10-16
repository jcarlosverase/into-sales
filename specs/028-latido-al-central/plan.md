# Plan — 028 Latido al servicio central

Spec: [spec.md](spec.md) · Datos: [data-model.md](data-model.md) · Tareas:
[tasks.md](tasks.md) · Contrato que se consume:
`into-central/specs/001-clientes-planes-y-salud/contracts/api.md`.

## Constitution Check (1.5.0)

| Principio | Cómo se cumple |
|---|---|
| I. Seguridad | La llave se cifra con `lib/crypto` (AES-256-GCM); solo salen sus últimos 4. El cliente HTTP nunca escribe la llave ni la URL completa en un error |
| II. Soberanía | Conector opcional: bandera `INTO_CENTRAL_URL` apagada por defecto; adaptador `src/server/central/client.ts` con el contrato público del central; sin él la instancia está completa y un fallo del central solo se anota; la llave es la del propio negocio con into (condición 4, enmendada); la CI corre con la bandera apagada y encendida |
| III. Multi-tenancy | `central_license.organization_id` NOT NULL, único, y toda consulta por `scoped()` |
| IV. Idempotencia | Guardar la llave reemplaza la fila (un `upsert` por organización); un latido repetido no cambia nada en el CRM |
| V/IX. Verificación | Unitarias del adaptador, la bandera y los chequeos; guion E2E con el mock del central; prueba en vivo contra into-central en local |
| VI. Specs | Ciclo completo: migración `0020` y contrato externo |
| VIII. Foco vertical | Enmendado en 1.5.0: un conector opcional al servicio central del proveedor que instala el CRM entra; billing y multi-instancia dentro del CRM siguen fuera |

## Piezas

| Pieza | Dónde |
|---|---|
| Bandera | `src/server/central/flag.ts`: `leerConfigCentral(env)` → `{ activo, url, host }` o `{ activo: false, problema: "url" \| null }`. Se lee de `process.env` directo, como `agendaEnabled()` |
| Adaptador | `src/server/central/client.ts`: `enviarLatido({ url, llave, cuerpo, fetch, timeoutMs })` → `{ ok: true, respuesta }` o `{ ok: false, resultado }`. Valida la respuesta con Zod |
| Llave | `src/server/central/license.ts`: guardar (cifrada), leer pública, leer secreta, quitar, anotar el resultado del latido |
| Chequeos | `src/server/central/checks.ts`: los cinco estados (D3) con las funciones del doctor (`mediaDirStatus`, `checkWhatsApp`, `estadoIaDe`, `checkDispatch`) |
| Latido | `src/server/central/heartbeat.ts`: `latirAhora(organizationId)` y el temporizador `iniciarLatidos()` (al arrancar y luego `next_heartbeat_seconds`, entre 60 y 3 600) |
| Arranque | `instrumentation-node.ts`: `iniciarLatidoCentral()`, que avisa una vez si la bandera está mal escrita |
| API | `GET/PUT/DELETE /api/settings/central` (con `canConfigure`; 404 sin bandera) |
| Pantalla | Ajustes → Negocio → «Plan» (`/settings/central`), `src/components/settings/central-client.tsx` |
| Salud | `/api/health` → `features.central` |
| Doctor | Sección «Servicio central (opcional)»: no definido, URL inválida o «late a api.into.center» |
| Mock | `src/app/api/dev/central-mock/v1/heartbeat` tras `mockGuard()`: una llave que termina en `0000` responde 401; una que termina en `5000`, 500; el resto, 200 con un plan de ejemplo |

## Flujo de un latido

1. Lee la llave de la organización; sin llave, nada.
2. Arma el cuerpo: versión y commit (`APP_VERSION`, `resolveCommit()`), la hora
   de arranque del proceso y los cinco chequeos.
3. `POST {INTO_CENTRAL_URL}/v1/heartbeat` con `Authorization: Bearer <llave>`
   y 10 s de límite.
4. Anota en `central_license`: hora, resultado y, si fue 200, plan, estado de
   la cuenta y el intervalo pedido.
5. Programa el siguiente con el intervalo acotado (o 900 s).

Nada de esto corre dentro de una petición de usuario, salvo el latido inmediato
al guardar la llave, que también tiene su límite de 10 s y responde aunque el
central no conteste.

## Pruebas

- Unitarias: bandera, cuerpo (solo lo del contrato), mapa de resultados del
  adaptador (200, 400, 401, 429, 500, red caída, respuesta rara), que el error
  nunca contenga la llave, intervalo acotado, peor estado de WhatsApp, vista
  pública sin la llave.
- E2E (`scripts/e2e-selftest.mjs`, `centralChecks`): con la bandera apagada,
  404 y `features.central: false`; encendida contra el mock, llave inválida en
  formato, llave aceptada y su plan, llave rechazada, central caído, quitar la
  llave, que la llave no salga en ninguna respuesta, y «Plan» a 360 px.
- En vivo: into-sales local latiendo a into-central local; el cliente aparece
  vivo en el panel del central.

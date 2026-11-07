# 1029 — Contrato de API

Amplía [el contrato de la 015](../../015-universal-booking-engine/contracts/agenda.md).
Todo es aditivo: un cliente que no conoce estos campos sigue funcionando. Con `AGENDA`
apagada, cada ruta nueva responde 404. Sin profesionales, `/api/bot/*` responde lo
mismo que antes. Mismo sobre de error, `201` al crear y `200` al
mover.

Las etiquetas (`label`) van en am/pm desde la spec 1030. El campo `time` sigue en 24 horas.

## Códigos de error nuevos

| Código | Estado | Cuándo |
|---|---|---|
| `resource_not_found` | 404 | No existe o es de otra organización |
| `resource_archived` | 409 | Se pidió a alguien archivado |
| `resource_has_bookings` | 409 | Archivar con citas futuras; trae `count` |
| `resource_name_taken` | 409 | Otro activo con ese nombre |

## Operador

### `GET /api/calendar/resources`

Sesión. `?includeArchived=true` también trae los archivados.

```json
{ "resources": [{ "id": "res_x", "kind": "person", "name": "Dra. Ana",
    "weeklyHours": { "mon": [{ "start": "09:00", "end": "13:00" }] },
    "position": 0, "active": true }],
  "agentResourceMode": "first_free" }
```

### `POST /api/calendar/resources`

Dueños y administradores. Body: `{ kind, name, weeklyHours? }`. Sin `weeklyHours`, copia
el del negocio. `201` → `{ resource, adoptedBookings }`, donde `adoptedBookings` son
las citas futuras que adoptó, si es el primero.

### `PATCH /api/calendar/resources/:id`

Dueños y administradores. Body: cualquier subconjunto de `name`, `kind`, `weeklyHours`,
`position`, `active`. `200` → `{ resource }`.

### `PUT /api/calendar/settings`

Acepta además `agentResourceMode`: `first_free` · `ask`.

### `GET /api/calendar/availability`

Acepta `resourceId`. Sin él, la unión de todos, sin repetir instantes. Cada hueco suma
`resourceIds`, con quién está libre en ese instante; sin profesionales va `[]`.

### `GET /api/bookings`

Acepta `resourceId`. Cada cita suma `resource: { id, name, kind } | null`. Con rango,
la respuesta suma `resources`.

### `POST /api/bookings`

- `kind: "session"`: `resourceId` opcional. Sin él, con profesionales, uno libre al azar.
- `kind: "block"`: `resourceId` opcional. Sin él, bloqueo de todo el negocio.

### `PATCH /api/bookings/:id`

Al reprogramar acepta `resourceId`. Sin él conserva al profesional.

## Bot

### `GET /api/bot/availability`

Acepta `resourceId`: un id o `any`. Registra la oferta con ese profesional, y con `any`
o sin él, sin profesional. Suma a la respuesta:

```json
{ "resourceMode": "ask",
  "resources": [{ "id": "res_x", "name": "Dra. Ana", "kind": "person" }] }
```

Sin profesionales no van. Con ellos, cada hueco suma `resourceIds`.

### `POST /api/bot/bookings` y `PATCH /api/bot/bookings`

Aceptan `resourceId` opcional. La oferta manda:

| Oferta | `resourceId` pedido | Resultado |
|---|---|---|
| Con persona R | Ausente o R | Cita con R |
| Con persona R | Otra | `409 slot_not_offered` con la oferta vigente |
| Sin persona | Ausente | Uno libre, al azar |
| Sin persona | S, libre | Cita con S |
| Sin persona | S, ocupado | `409 slot_taken` con alternativas de S |

El `201` suma `resource: { id, name } | null`.

### `GET /api/bot/context`

`booking.next`, `unresolved` y `lastClosed` suman `resource` si la cita lo tiene. Con
profesionales, el bloque suma `resourceMode` y `resources`.

## Agente incluido

```json
{"action":"offer_slots","resourceId":"res_x","reply":"..."}
{"action":"book_slot","startUtc":"...","resourceId":"res_x","reply":"..."}
```

`resourceId` es opcional en las dos y `offer_slots` acepta `"any"`. El prompt solo lista
profesionales con 2 o más activos. El mapa de huecos del modelo (`HEADER_SLOTS`) no
cambia: con quién lo sabe la oferta, y `book_slot` no necesita repetirlo.

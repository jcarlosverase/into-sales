# Contrato — 022 Reparto de leads

Rutas internas de la app (las consume la interfaz, con sesión). `/api/bot/*`,
el webhook y la forma de los eventos SSE **no cambian**.

Supervisor = rol `owner` o `admin`. Vendedor = rol `member`.

## Cambia según quién pregunta

Para un vendedor, estas rutas se limitan a los leads asignados a él. Lo ajeno
responde `404 not_found` (D8):

| Ruta | Efecto para el vendedor |
|---|---|
| `GET /api/conversations` | Solo conversaciones de contactos con lead suyo. |
| `PATCH /api/conversations/{id}` | 404 si no es suya. |
| `GET/POST /api/conversations/{id}/messages`, `…/media`, `…/template` | 404 si no es suya. |
| `GET /api/pipeline/board` | Solo sus leads. |
| `GET /api/contacts`, `GET/PATCH /api/contacts/{id}`, `POST /api/contacts/{id}/start-conversation` | Solo contactos con lead suyo. |
| `GET /api/media/{assetId}` | 404 si el adjunto es de una conversación ajena. |
| `GET /api/events` (SSE) | No recibe `message.new`, `message.status` ni `conversation.updated` de conversaciones ajenas. |

## Campos nuevos

`GET /api/pipeline/board` — cada lead gana:

```json
"assignee": { "id": "usr_…", "name": "Ana Torres" }
```

`null` si está sin asignar. La respuesta gana `"canAssign": true | false`
(¿quien pregunta puede reasignar?) y `"team": [{ "id", "name" }]`, todo el
equipo al que se puede asignar, supervisores incluidos (vacía para un
vendedor). El turno automático solo reparte entre vendedores; a mano, un
supervisor puede quedarse un lead.

`GET /api/contacts/{id}` — el objeto `lead` gana el mismo `assignee`.

## Reasignar

`PATCH /api/pipeline/leads/{id}` acepta un campo nuevo:

```json
{ "assignedUserId": "usr_…" }   // o null para dejarlo sin asignar
```

| Caso | Respuesta |
|---|---|
| Quien pide es vendedor | `403 forbidden` |
| El usuario no es del equipo | `422 invalid_assignee` |
| Lead inexistente o de otra organización | `404 not_found` |

Se puede combinar con los demás campos del PATCH (monto, prioridad, etapa).

## Configuración del reparto

`GET /api/settings/lead-routing` (cualquier miembro):

```json
{
  "enabled": true,
  "canEdit": true,
  "members": [
    { "userId": "usr_…", "name": "Ana Torres", "email": "ana@…", "receivesLeads": true }
  ]
}
```

`members` lista solo vendedores (rol `member`), en el orden del turno.

`PUT /api/settings/lead-routing` (solo supervisores; vendedor → `403`):

```json
{ "enabled": false }
{ "userId": "usr_…", "receivesLeads": false }
```

Los dos campos son opcionales y se pueden mandar juntos. Un `userId` que no
es vendedor de la organización → `422 invalid_member`. Responde con el mismo
cuerpo que el `GET`.

# 1023 — Modelo de datos

Migración aditiva `0027`. Cuatro tablas nuevas. No cambia ninguna columna
existente. Todas las fechas son `timestamp(..., { withTimezone: true })`
(spec 1002). Ids con nanoid y prefijo. La migración se aplica siempre, como la
agenda: unas tablas vacías son inertes.

## `stamp_program` (`spg_`)

El programa de la instancia. Uno activo por organización en esta versión (D3).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | |
| `organization_id` | text FK → organization, cascade | único mientras `status <> 'archived'` |
| `name` | text | 1–40, «Café La Esquina» |
| `stamps_required` | integer | 2–30 |
| `reward` | text | 1–60, «1 bebida gratis» |
| `terms` | text null | hasta 300 |
| `color` | text | hex `#RRGGBB`, por defecto el acento de la instancia |
| `min_hours_between_stamps` | integer | 0–168, 0 = sin freno (D7) |
| `join_phrase` | text | por defecto «Quiero mi tarjeta de sellos» (D4) |
| `join_reply` | text | con `{nombre}`, `{negocio}`, `{enlace}` |
| `notify_on_complete` | boolean | por defecto `false` (D10) |
| `complete_template_id` | text null FK → template | plantilla de utilidad si la ventana está cerrada |
| `status` | text | `active` · `paused` · `archived` |
| `version` | integer | sube con cada cambio, para actualizar la clase de Google |
| `created_at`, `updated_at` | timestamptz | |

## `stamp_card` (`stc_`)

Una por contacto y programa (D2).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | |
| `organization_id` | text FK | |
| `program_id` | text FK → stamp_program, cascade | |
| `contact_id` | text FK → contact, cascade | único con `program_id` |
| `serial` | text único | aleatorio de 22 caracteres. Va en el QR (`/s/<serial>`), es el `serialNumber` de Apple y el sufijo del objeto de Google |
| `public_token_hash` | text único | SHA-256 del token de `/c/<token>`; el token solo se ve al generarlo y en el enlace enviado |
| `apple_auth_token_hash` | text | SHA-256 del `authenticationToken` del pase |
| `stamps` | integer | sellos del ciclo actual, ≥ 0 |
| `rewards_redeemed` | integer | canjes acumulados |
| `last_stamp_at` | timestamptz null | |
| `pass_version` | integer | sube con cada cambio; Apple usa `updated_at` y Google este número |
| `google_object_saved` | boolean | el cliente la guardó en Google Wallet (lo dice el central) |
| `google_link_issued_at` | timestamptz null | migración `0028`: cuándo se dio el enlace «Guardar en Google Wallet»; desde entonces cada cambio se pasa al central |
| `wallet_sync_pending` | boolean | hay una actualización de wallet por reintentar (D9) |
| `created_at`, `updated_at` | timestamptz | |

Índices: `(organization_id, contact_id)` y `(wallet_sync_pending) where true`.

Desde la implementación (2026-11-05):

- `stamps_required` (integer): los sellos que completan **este** ciclo. Se
  copia del programa al crear la tarjeta y en cada canje, para que cambiar el
  programa no toque un ciclo en curso (D3).
- El token público y el `authenticationToken` no son aleatorios guardados:
  se **derivan** de la tarjeta con HMAC-SHA256 sobre `ENCRYPTION_KEY` (128
  bits). La base sigue guardando solo su SHA-256, pero el CRM puede volver a
  dar el mismo enlace al repetir la frase o desde la ficha sin rotarlo.
- `serial` es alfanumérico de 22 caracteres. El `serialNumber` de Apple y el
  sufijo de Google le antepondrán el `wallet_scope` del central
  (`<scope>-<serial>`, corte 2).

## `stamp_event` (`ste_`)

La bitácora (D7). Solo se inserta.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | |
| `organization_id` | text FK | agregado al implementar: toda tabla de dominio lo lleva (Principio III) |
| `card_id` | text FK → stamp_card, cascade | |
| `kind` | text | `join` · `stamp` · `redeem` · `adjust` |
| `delta` | integer | +1 al sellar, −N al canjear, ± al ajustar |
| `stamps_after` | integer | |
| `source` | text | `whatsapp` · `panel` · `qr` |
| `user_id` | text null FK → user | null en el alta por WhatsApp |
| `forced` | boolean | se confirmó saltando el mínimo de horas |
| `idempotency_key` | text | único con `card_id` (AC5) |
| `created_at` | timestamptz | |

## `apple_pass_registration` (`apr_`)

Dispositivos que registraron un pase (servicio web de Apple, AC9).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | |
| `organization_id` | text FK | agregado al implementar (Principio III) |
| `card_id` | text FK → stamp_card, cascade | |
| `device_library_id` | text | lo da Apple |
| `push_token` | text | se le pasa al central para el aviso (D8) |
| `created_at` | timestamptz | |

Único: `(device_library_id, card_id)`. Al dar de baja, se borra la fila.

## Lo que NO se guarda

- Credenciales de Apple o Google: viven en into-central (D8).
- El token público y el de Apple en claro: solo sus hashes.
- Imágenes del pase: se generan al pedirlas desde el programa y la marca.

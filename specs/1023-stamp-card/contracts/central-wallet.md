# Contrato: wallet en el servicio central

La fuente de este contrato es into-central:
[`specs/016-wallet-passes/contracts/api.md`](../../../../into-central/specs/016-wallet-passes/contracts/api.md).
No se copia aquí para que las dos versiones no se separen.

Resumen de lo que usa la 1023 (D8), todo con `Authorization: Bearer <llave>`:

- `GET /v1/wallet/config`: prefijo del cliente, Pass Type ID, Team ID e
  Issuer ID.
- `POST /v1/wallet/apple/sign`: firma el `manifest.json` de un pase.
- `POST /v1/wallet/apple/push`: avisa a los iPhone que un pase cambió.
- `PUT /v1/wallet/google/classes/{sufijo}`: crea o actualiza la clase del
  programa.
- `POST /v1/wallet/google/save-link`: enlace «Guardar en Google Wallet».
- `PATCH /v1/wallet/google/objects/{sufijo}`: actualiza los sellos.

El central nunca recibe nombre, teléfono, identidad de WhatsApp ni
conversaciones (AC11).

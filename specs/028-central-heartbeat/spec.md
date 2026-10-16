# 028 — Latido al servicio central de into

**Created**: 2026-10-14

**Status**: Especificada antes de escribir código. Implementada; gates y guion
E2E en verde con la bandera apagada y encendida, y probada en local contra
into-central (el cliente aparece «Sana» en su panel).

**Input**: pedido de Juan Carlos el 2026-10-14. into opera un servicio
central (`into-central`, spec 001 de ese repo) que vigila las instalaciones
de IntoSales de sus clientes: cada CRM le manda un latido con el resultado de
su diagnóstico y el central le responde con su plan. El contrato está en
`into-central/specs/001-customers-plans-and-health/contracts/api.md`.

**Carril**: ciclo completo (Principio VI). Toca el **modelo de datos** (tabla
nueva para la llave de licencia, migración aditiva `0020`) y consume un
**contrato publicado** de otro repo. Requiere además una **enmienda de la
constitución** (Principios II y VIII): ver
[constitution-amendment.md](constitution-amendment.md). Plan en
[plan.md](plan.md), datos en [data-model.md](data-model.md), tareas en
[tasks.md](tasks.md).

## Problema

into instala y mantiene IntoSales para sus clientes, uno por VPS. Hoy se entera
de que un CRM se cayó, de que su WhatsApp se desconectó o de que su llave de IA
dejó de servir cuando el cliente llama. Y el cliente no tiene, dentro de su
CRM, dónde ver qué plan contrató con into.

## Historias

**H1 — El CRM late al central.** Con el servicio central encendido y la llave
de licencia guardada, el CRM le manda al central un latido al arrancar y luego
cada 15 minutos (o lo que el central pida), con su versión y el estado de cada
chequeo de su diagnóstico: `ok`, `warn`, `fail` o `skip`. Nunca el detalle.

**H2 — Quien administra pega la llave.** En Ajustes → Negocio → «Plan», pega
la llave de licencia que le dio into. El CRM la guarda cifrada, late en ese
momento y le dice si el central la aceptó.

**H3 — Ve su plan.** En esa misma pantalla ve el plan que devuelve el central
(nombre y código), si su cuenta está activa o suspendida y cuándo fue el
último latido y cómo salió.

**H4 — Sin central, nada cambia.** Una instancia sin la bandera no late, no
muestra «Plan» y no pide ninguna llave. Con la bandera encendida pero sin
llave, o con el central caído, el CRM atiende igual.

## Decisiones

**D1 — Conector opcional detrás de una bandera (Principio II).** La bandera
es `INTO_CENTRAL_URL`, la URL base del central (en producción,
`https://api.into.center`; en desarrollo, `http://localhost:3001`, con
into-sales en el 3000). Vacía o ausente, el conector no existe: no hay
pantalla, la API de ajustes responde 404 y no corre ningún temporizador. Una
URL mal escrita (que no sea `http://` o `https://`, o que lleve
`usuario:clave`) deja el conector inactivo y lo dicen el arranque y el
doctor; nunca tumba el CRM.

**D2 — La llave se pega en la app, cifrada en reposo (Principio I).** La
llave (`into_live_` y 32 letras y números) se guarda con AES-256-GCM (`lib/crypto`),
como el token de WhatsApp. Hacia la pantalla, el doctor, `/api/health` y los
registros solo salen sus últimos 4. No hay variable de entorno para la llave:
una variable no está cifrada en reposo y viaja a cualquier proceso.

**D3 — Qué se manda.** Exactamente el cuerpo del contrato: `app_version`,
`app_commit` (si se conoce), `app_started_at` y los chequeos `database`,
`media_dir`, `whatsapp`, `ai` y `dispatch` con su estado. Ni teléfonos, ni
nombres, ni mensajes, ni detalle de los errores. El estado de cada chequeo
sale de las mismas funciones del doctor:

| Chequeo | `ok` | `warn` | `fail` | `skip` |
|---|---|---|---|---|
| `database` | La consulta del latido respondió | — | — | — |
| `media_dir` | `MEDIA_DIR` escribible | — | No escribible | Entorno sin validar |
| `whatsapp` | Meta respondió con el token guardado | Meta no respondió | Token rechazado o que no descifra | Sin número conectado |
| `ai` | Proveedor configurado y activo | — | Llave rechazada o sin saldo | Sin configurar |
| `dispatch` | Despacho al cerebro activo | Mal configurado | — | No configurado |

Con varios números de WhatsApp, cuenta el peor.

**D4 — Un fallo del central jamás bloquea el CRM (Principio II).** Cada latido
tiene 10 segundos de límite y corre fuera de cualquier petición de usuario; un
error se anota y el siguiente latido llega a su hora. Si el central responde
que la cuenta está **suspendida**, el CRM solo lo muestra en «Plan»: en esta
versión no limita nada.

**D5 — Cada cuánto.** Al arrancar y luego cada `next_heartbeat_seconds` que
responde el central, acotado entre 60 y 3 600 segundos; sin respuesta, 900. Al
guardar la llave, en ese momento.

**D6 — Qué se recuerda del último latido.** Junto a la llave se guardan la
hora del último intento, cómo salió (`ok`, `llave_invalida`, `limite`,
`rechazado`, `sin_respuesta`), el plan y el estado de la cuenta del último
latido aceptado. Así «Plan» muestra algo útil después de un reinicio, sin
esperar al siguiente latido.

## Comportamiento observable y criterios de aceptación

- **AC1** — Sin `INTO_CENTRAL_URL`: Ajustes no muestra «Plan»,
  `GET /api/settings/central` responde 404, `/api/health` dice
  `features.central: false`, el doctor marca el conector como no definido y
  no sale ningún latido.
- **AC2** — Con la bandera y sin llave, «Plan» pide la llave y el CRM no late.
- **AC3** — Al guardar una llave válida, el CRM late en ese momento; «Plan»
  muestra el nombre y el código del plan, «Activa» o «Suspendida», la hora del
  latido y la llave como `…XXXX`.
- **AC4** — Una llave con otro formato se rechaza en el formulario sin llamar
  al central. Una que el central rechaza (401) se guarda igual y «Plan» dice
  «El central no reconoce esta llave».
- **AC5** — El latido lleva solo lo del contrato (D3). La llave no aparece en
  ninguna respuesta de la API, en el HTML ni en los registros.
- **AC6** — Con el central caído, sin respuesta o respondiendo 500, el CRM
  sigue atendiendo; «Plan» dice «Sin respuesta del central» y el siguiente
  latido se intenta a su hora.
- **AC7** — Quitar la llave deja de latir y borra lo guardado del último
  latido.
- **AC8** — Solo quien puede configurar el negocio ve y cambia la llave.
- **AC9** — «Plan» se usa a 360 px sin scroll horizontal.

## Qué se decidió NO hacer y por qué

- **Limitar el CRM según el plan o la suspensión**: es otra decisión de
  producto; aquí solo se muestra (D4).
- **Variable de entorno con la llave**: no estaría cifrada en reposo (D2).
- **Mandar el detalle de los chequeos**: el central no lo guarda por diseño
  (su Principio II, «Mínimo dato»).
- **La ruta de IA del central (fase 2)**: llega con su propia spec.

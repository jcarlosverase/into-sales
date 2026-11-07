# E2E — Agenda con profesionales (spec 1029)

Guion: `scripts/e2e-agenda-resources.mjs`. Corre con `AGENDA=on` (configuración
`completo`) y comprueba el 404 con la agenda apagada (`default`).

## Con `AGENDA` apagada

1. `GET` y `POST /api/calendar/resources` y `PATCH /api/calendar/resources/:id`
   responden 404.

## Ajustes

1. Sin profesionales no aparece el modo del agente. Con dos, sí.
2. Un profesional nuevo copia el horario del negocio, y se puede editar.

## Citas

1. Con dos personas, «Nueva cita» pregunta quién atiende y ofrece «Primero libre».
2. Dos personas tienen cita al mismo instante; la misma persona recibe 409.
3. `?resource=` filtra el calendario y esconde a la otra persona.
4. El detalle dice con quién, y mover parte de esa persona.
5. Bloquear pregunta a quién.
6. A 360 px, Citas y Ajustes no desbordan y el filtro mide al menos 40 px.

## Agente

1. «Primero libre»: ofrece sin preguntar y confirma con el nombre.
2. «Preguntar»: el motor nombra a las dos personas, y la reserva queda con la elegida.

## Bot

1. `GET /api/bot/availability?resourceId=` da los huecos de esa persona, el modo y
   la lista.
2. Reservar con otra persona responde `slot_not_offered`.
3. Sin `resourceId`, la cita queda con quien se ofreció.

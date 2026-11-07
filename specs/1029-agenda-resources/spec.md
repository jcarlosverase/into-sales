# 1029 — Agenda con profesionales o recursos

**Created**: 2026-11-06

**Status**: Implementada; pruebas en verde. Falta la verificación humana con WhatsApp real (T040).

**Input**: Juan Carlos el 2026-11-06: agenda con profesionales o recursos, cada uno
con su horario; la cita guarda con quién es, sin obligar a los negocios de una sola
persona; anti doble cita por profesional; elegir con quién en Citas; y un agente que
pregunta «¿con quién?» o asigna al primero libre, según la configuración. Incluye
crear citas a mano desde el calendario.

**Carril**: ciclo completo. Plan: [plan.md](plan.md) · Datos:
[data-model.md](data-model.md) · Contrato: [contracts/agenda.md](contracts/agenda.md)
· Tareas: [tasks.md](tasks.md).

**Base**: spec [015](../015-universal-booking-engine/spec.md), que dejó fuera «múltiples
calendarios por agente».

## Problema

Hoy hay una agenda por negocio: un horario en `calendar_settings` y el índice
`booking_org_active_slot_uq`, que permite una sola cita por instante en todo el
negocio. Una clínica con dos doctores no puede dar dos citas a las 10:00, y nadie sabe
con quién es cada cita. Tampoco se puede agendar una sala o un equipo. Además, solo el
agente de IA crea citas: quien atiende una llamada o a un cliente en el local no puede
anotarla en el calendario, aunque `POST /api/bookings` ya lo acepta.

## Reglas de fondo

- **Sin profesionales, nada cambia.** Un negocio sin profesionales activos funciona
  exactamente como hoy, con el mismo horario, las mismas respuestas y los mismos E2E.
- **El motor decide, no el modelo.** Sigue la regla de la 015: el agente solo reserva
  lo que el sistema ofreció, y ahora eso incluye con quién.
- **Todo detrás de `AGENDA`.** Apagada, cada ruta nueva responde 404 y la pantalla no
  existe. Las tablas se crean siempre (ADR-001).

## Historias de usuario

### H0 — Crear una cita a mano (P1)

La recepcionista atiende una llamada, abre Citas, pulsa «Nueva cita», busca al contacto
y elige un hueco libre.

**Prueba independiente:** crear una cita desde el calendario, sin profesionales, y
abrir su conversación desde el detalle.

**Aceptación**

- **AC29** — En Citas, «Nueva cita» abre un diálogo con el contacto, los huecos libres
  y una nota opcional.
- **AC30** — El contacto se busca por nombre o teléfono. Un vendedor solo encuentra sus
  contactos (spec 022).
- **AC31** — Sin contacto o sin hueco, «Crear cita» está desactivado.
- **AC32** — La cita queda con origen manual y aparece en el calendario, en su día.
- **AC33** — La cita toma la conversación del contacto, si tiene, para que el detalle
  ofrezca «Abrir conversación». Las del Laboratorio no cuentan.
- **AC34** — Si el hueco se ocupó en el camino, el diálogo lo dice y vuelve a pedir los
  huecos libres. No se crea nada.
- **AC35** — La cita no le manda un mensaje al contacto, y el diálogo lo dice.

### H1 — Registrar profesionales y sus horarios (P1)

La dueña de una clínica entra a Ajustes → Agenda y crea a la Dra. Ana, que atiende de
lunes a viernes, y al Dr. Luis, que atiende martes, jueves y sábado.

**Prueba independiente:** crear dos profesionales con horarios distintos y comprobar
que la disponibilidad de cada uno sigue su horario.

**Aceptación**

- **AC1** — Se crea, edita, ordena y archiva un profesional o recurso, con nombre,
  tipo (persona o recurso) y horario semanal. Solo dueños y administradores pueden.
- **AC2** — Un profesional nuevo arranca con una copia del horario del negocio.
- **AC3** — Con al menos un profesional activo, se agenda en su horario, y el del
  negocio es el límite: lo que se salga de él no se ofrece. Lo que un profesional tenga
  fuera del horario general se recorta al calcular, sin cambiar lo guardado.
- **AC4** — Al crear el primer profesional, las citas futuras sin profesional pasan a
  él, en la misma transacción. Los bloqueos no cambian.
- **AC5** — No se puede archivar a quien tiene citas futuras: el sistema dice cuántas
  para moverlas antes. Lo archivado no se ofrece, pero sus citas pasadas conservan el
  nombre. No hay borrado.

### H2 — Dos citas a la misma hora con personas distintas (P1)

La Dra. Ana y el Dr. Luis tienen cita a las 10:00 el mismo día. Otra cita con la Dra.
Ana a las 10:00 se rechaza, aunque dos personas la pidan al mismo tiempo.

**Prueba independiente:** dos reservas simultáneas al mismo instante, con la misma
persona y con personas distintas, contra PostgreSQL real.

**Aceptación**

- **AC6** — Dos citas al mismo instante con profesionales distintos conviven.
- **AC7** — Dos citas simultáneas al mismo instante con el mismo profesional: gana una
  y la otra recibe `slot_taken` con alternativas. La base lo garantiza.
- **AC8** — Un bloqueo puede ser de un profesional o de todo el negocio. El de todo el
  negocio ocupa a todos; el de una persona, solo a esa persona.
- **AC9** — Un bloqueo de todo el negocio en el instante exacto de una cita agendada
  se rechaza con `slot_taken`, igual que hoy.
- **AC10** — Una cita sin profesional, en un negocio que ya los tiene, ocupa a todos.
- **AC11** — Las citas del Laboratorio llevan profesional, pero no consumen la agenda
  real.

### H3 — Elegir con quién en Citas (P1)

La recepcionista crea una cita, elige a la Dra. Ana y ve solo sus huecos. También puede
mirar el calendario de una sola persona.

**Prueba independiente:** con dos profesionales, crear una cita desde «Nueva cita» y
filtrar el calendario por uno, en escritorio y a 360 px.

**Aceptación**

- **AC12** — Con 2 o más profesionales, «Nueva cita» tiene «Con quién atiende»: cada
  profesional y «Primero libre». Los huecos cambian según lo elegido.
- **AC13** — Con un profesional no se pregunta: la cita queda con él. Sin
  profesionales, solo se eligen contacto y hueco (H0).
- **AC14** — El calendario se filtra por profesional, el filtro queda en la dirección
  de la página y cada cita muestra con quién es en la rejilla, la lista y el detalle.
- **AC15** — Mover una cita conserva al profesional, y el panel permite cambiarlo. Los
  huecos ofrecidos son los del profesional elegido.
- **AC16** — «Bloquear horario» pregunta si es de todo el negocio o de una persona.
- **AC17** — Citas y Ajustes funcionan a 360 px sin desborde horizontal, con objetivos
  táctiles de al menos 40 px.

### H4 — El agente pregunta o asigna según la configuración (P2)

En modo «Preguntar», el agente le dice al cliente con quién puede atenderse. En modo
«Primero libre», ofrece horarios sin preguntar y asigna a quien esté libre.

**Prueba independiente:** una conversación de punta a punta con el mock de IA en cada
modo, y un cerebro externo contra `/api/bot/*`.

**Aceptación**

- **AC18** — Ajustes → Agenda tiene el modo del agente: «Preguntar con quién» o
  «Asignar al primero libre» (por defecto). Solo se ve con 2 o más profesionales.
- **AC19** — En «Preguntar», `offer_slots` sin profesional no ofrece horarios: el motor
  responde con la pregunta y los nombres reales, sin dejarlo al modelo.
- **AC20** — Cuando el cliente elige, el agente ofrece solo los huecos de esa persona y
  la reserva queda con ella. Si le da igual, se ofrecen los de todos.
- **AC21** — En «Primero libre» se ofrecen los huecos de todos, sin repetir instantes,
  y la reserva asigna al azar entre quienes estén libres en ese instante.
- **AC22** — Una reserva con un profesional distinto del ofrecido se rechaza con
  `slot_not_offered`, como un horario inventado. Un id inventado vuelve a preguntar.
- **AC23** — La confirmación dice con quién quedó la cita cuando hay 2 o más
  profesionales.
- **AC24** — El contexto del agente incluye al profesional de la cita, y un cerebro
  externo recibe `resources` y `resourceMode`. Un cerebro que no los conoce sigue
  funcionando: sus citas se asignan al primero libre.
- **AC25** — Si se ocupa el hueco, las alternativas son de la misma persona. Si esa
  persona no tiene más huecos, el agente lo dice y ofrece a las demás.

### H5 — Un negocio de una sola persona no nota nada (P1)

**Prueba independiente:** los E2E actuales de agenda, sin cambios y sin profesionales.

**Aceptación**

- **AC26** — Sin profesionales activos, disponibilidad, reservas, agente y pantallas
  responden igual que hoy, sin campos obligatorios nuevos.
- **AC27** — Con `AGENDA` apagada, toda ruta nueva responde 404.
- **AC28** — La migración se puede ejecutar dos veces sin error y no cambia ninguna cita
  existente.

## Casos límite

- **Se archiva al último profesional:** el negocio vuelve al horario general.
- **Cambia el horario de un profesional:** las citas existentes no se mueven.
- **Dos profesionales libres en un instante, con modo «Primero libre»:** se elige al
  azar, para no cargar siempre a la misma persona.
- **El negocio achica su horario:** los profesionales se recortan solos, y las citas
  existentes no se mueven.
- **El cliente pide a alguien que no existe:** el motor vuelve a preguntar con los
  nombres reales.
- **Un cerebro externo reserva sin `resourceId` en modo «Preguntar»:** se asigna el
  primero libre, porque romper su reserva sería peor.
- **Cambio de hora:** los horarios siguen siendo de pared en la zona del negocio.

## Requisitos funcionales

- **FR-001** — Nueva entidad de profesional o recurso, por organización, con orden y
  estado activo.
- **FR-002** — `booking` guarda el profesional de forma opcional.
- **FR-003** — La disponibilidad se calcula por profesional: su horario dentro del
  horario del negocio, menos sus citas y bloqueos, menos lo que ocupa a todos.
- **FR-004** — La duración, el margen, el aviso mínimo y la ventana siguen siendo del
  negocio.
- **FR-005** — La unicidad por instante pasa a ser por profesional, en la base.
- **FR-006** — Revalidar e insertar ocurre bajo un candado de la organización.
- **FR-007** — La oferta recuerda con quién se ofreció cada horario.
- **FR-008** — Todas las pantallas nuevas usan el sistema de diseño (spec 1021).
- **FR-009** — Toda consulta filtra por organización (Constitución III).

## Fuera de alcance

- **Duración o servicios por profesional.** Una cita dura lo que dice el negocio.
- **Calendario externo por profesional:** Google o Zoom siguen siendo uno por negocio.
- **Cuenta de usuario del profesional, y «mis citas».** Un profesional es un nombre en
  la agenda, no un miembro del equipo.
- **Excepciones de horario por fecha** (vacaciones): se resuelven con un bloqueo.
- **Reparto por carga** en «Primero libre» (es al azar) y **Resultados por profesional**.
- **Citas de varios profesionales a la vez.**
- **Avisar al contacto de una cita manual:** fuera de la ventana de 24 horas, WhatsApp
  exige una plantilla.

## Criterios de éxito

- **SC-001** — 1,000 pares de reservas simultáneas no producen ninguna doble cita por
  profesional.
- **SC-002** — Los E2E de agenda y calendario actuales pasan sin cambios.
- **SC-003** — Una clínica de dos doctores configura la agenda en menos de 5 minutos.
- **SC-004** — Con 20 profesionales, la disponibilidad de 14 días responde en menos de
  300 ms.

## Decisiones

Confirmadas por Juan Carlos el 2026-11-06.

1. **El horario del negocio limita el del profesional** (AC3).
2. **«Primero libre» elige al azar entre quienes están libres** (AC21).
3. **No se archiva a quien tiene citas futuras** (AC5).
4. **El primer profesional adopta las citas futuras** (AC4), para que no bloqueen a
   quien se agregue después (AC10).
5. **El cerebro externo no se rompe en modo «Preguntar»** (AC24).
6. **Solo dueños y administradores gestionan profesionales** (AC1). Hoy, Ajustes →
   Agenda lo puede guardar cualquier miembro.

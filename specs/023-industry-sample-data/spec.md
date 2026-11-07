# Feature Specification: Datos de ejemplo por rubro

**Feature Branch**: `feat/intosales`

**Created**: 2026-10-10

**Status**: Especificada antes de escribir código.

**Input**: pedido de Juan Carlos el 2026-10-10: «comandos para cargar
información de ejemplo para 3 rubros, que apliquen a los datos de ejemplo, las
plantillas de WhatsApp y la configuración del agente IA».

**Carril**: ligero (Principio VI). No toca el modelo de datos ni un contrato
publicado: escribe en tablas que ya existen, con comandos nuevos, y añade un
botón a la pantalla de Plantillas.

## Problema

Para una demo o un piloto hay que llegar con el CRM ya «vestido» del negocio
del cliente: conversaciones creíbles, plantillas que tiene sentido mandar y un
agente que ya sabe de qué se trata. Hoy solo existe `pnpm seed:demo`, que
carga una ferretería mexicana y además **borra todo** el conocimiento del
agente y las corridas del Laboratorio de la organización.

## Rubros

Los tres con los que empieza IntoSales, en Lima y en soles:

| Comando | Rubro | Negocio de ejemplo |
|---|---|---|
| `pnpm seed:academy` | Academia | Academia Horizonte: preuniversitaria e inglés |
| `pnpm seed:realestate` | Inmobiliaria | Inmobiliaria Altamira: departamentos en Lima |
| `pnpm seed:fashion` | Tienda de moda en línea | Lúa Moda: vestidos para mujer por Instagram y WhatsApp |
| `pnpm seed:dental` | Clínica dental | Clínica Dental Calma: endodoncia y odontología general en Pueblo Libre (añadido el 2026-11-06) |

## Decisiones

- **D1 — Un comando por rubro**, y cada uno carga las tres cosas: datos de
  ejemplo (contactos, conversaciones y leads en el Pipeline), plantillas de
  WhatsApp y la configuración del agente (perfil y conocimiento).
- **D2 — Lo de ejemplo se reconoce por su identidad**: cada contacto de
  ejemplo tiene la identidad `sample:<rubro>:<n>` y **no tiene teléfono**.
  Repetir el comando borra y recarga solo esos contactos (con sus
  conversaciones y leads); nunca toca un contacto real.
- **D3 — Ningún mensaje real sale por un ejemplo.** Sin teléfono ni identidad
  de WhatsApp, el envío falla antes de llegar a Meta («El contacto no tiene
  teléfono ni identidad de WhatsApp utilizable»).
- **D4 — Las plantillas entran como borrador** y nunca pisan una plantilla
  que ya se envió a Meta (pendiente, aprobada o rechazada). Para usarlas, el
  dueño las envía a revisión desde Configuración → Plantillas con el botón
  nuevo «Enviar a Meta», que abre el formulario de siempre con la plantilla
  cargada para que complete los ejemplos de cada variable.
- **D5 — El conocimiento del agente se suma, no se reemplaza.** Cada entrada
  de ejemplo se inserta solo si no existe una idéntica; las entradas del dueño
  no se borran.
- **D6 — El perfil del agente solo se llena si nadie lo configuró** (sin
  tono, instrucciones, reglas de escalado ni saludo). Si ya tiene algo, el
  comando lo deja y avisa; `--overwrite-agent` lo reemplaza. El interruptor
  del agente no se toca: queda como estaba.
- **D7 — Los leads de ejemplo entran al reparto por turno** (spec 022), como
  cualquier lead nuevo: así la demo enseña también a quién le toca cada uno.
- **D8 — `--reset` quita lo de ejemplo de ese rubro** (contactos y
  borradores de plantilla de ejemplo) sin cargar nada. El conocimiento y el
  perfil del agente no se quitan: pudieron editarse después.
- **D9 — Se puede cargar más de un rubro en la misma instancia**: los
  ejemplos de cada rubro tienen identidades y nombres de plantilla propios.
- **D10 — La demo de ferretería desaparece** (añadido el 2026-10-10, tras
  verla Juan Carlos en la pantalla del agente). `pnpm seed:demo` y el botón
  «Cargar datos de demostración» cargan la academia. Los comandos por rubro
  quitan lo que dejó la demo vieja de Vocero: sus 8 contactos (teléfono
  sintético y mensajes `wamid.demo.*`), sus entradas de conocimiento (texto
  exacto), su corrida del Laboratorio y el perfil «Martillito», que se
  reemplaza aunque el agente parezca configurado. Las personas del
  Laboratorio dejan de preguntar por taladros y martillos: hablan de un
  producto o servicio cualquiera.

## Comportamiento observable y criterios de aceptación

- **AC1** — Con una organización creada, `pnpm seed:academy` carga 6
  contactos con conversación y lead en distintas etapas, 3 plantillas en
  borrador, el conocimiento del agente y su perfil, e imprime un resumen.
- **AC2** — Correrlo otra vez deja exactamente los mismos 6 contactos de
  ejemplo (no duplica) y no duplica plantillas ni conocimiento.
- **AC3** — Un contacto real (creado a mano o por WhatsApp) sigue intacto
  después de correr cualquier comando, con o sin `--reset`.
- **AC4** — Una plantilla con el mismo nombre que ya está pendiente,
  aprobada o rechazada no cambia.
- **AC5** — Si el agente ya tiene instrucciones, el comando no las cambia y lo
  dice; con `--overwrite-agent` las reemplaza.
- **AC6** — Responder desde la Bandeja a una conversación de ejemplo muestra
  el error de destinatario y no llama a Meta.
- **AC7** — `pnpm seed:realestate`, `pnpm seed:fashion` y `pnpm seed:dental`
  cumplen lo mismo con sus datos; los cuatro pueden convivir.
- **AC8** — `--reset` deja la organización sin contactos ni borradores de
  ejemplo de ese rubro.
- **AC9** — Sin organización, el comando termina con un mensaje claro y no
  escribe nada.
- **AC10** — En Configuración → Plantillas, una plantilla en borrador muestra
  «Enviar a Meta», que abre el formulario con nombre, idioma, categoría y
  texto ya puestos.

## Qué NO se hace y por qué

| Qué | Por qué no |
|---|---|
| Enviar las plantillas a Meta desde el comando | Meta revisa cada plantilla y pide ejemplos realistas por variable; mandarlas sin mirar lleva a rechazos y quema la reputación del número. |
| Cambiar las etapas del Pipeline por rubro | Las etapas son del negocio; cambiarlas desde un ejemplo pisaría las del dueño. Los ejemplos usan las que trae la instalación. |
| Corridas de ejemplo del Laboratorio | Las da la primera corrida real con el conocimiento cargado. |
| Botón en la app para cargar un rubro | El pedido es de comandos; la instalación los corre. Se puede añadir después. |
| Mantener la ferretería como demo | Es otro producto y otro país; ver D10. |

## Ampliación del 2026-11-06: clínica dental y comandos en el VPS

**Input**: Juan Carlos el 2026-11-06, para el demo de un consultorio de
endodoncia: «agrega un comando "clínica dental"», con un nombre inventado para
el negocio y precios de referencia sacados de internet.

- **D11 — Cuarto rubro, `pnpm seed:dental`**: Clínica Dental Calma, endodoncia
  y odontología general en Pueblo Libre, con atención para pacientes con miedo
  al dentista. Cumple los mismos AC1 a AC9 que los otros tres. Los precios son
  de referencia de clínicas privadas de Lima (cuantomecuesta.com, abril de
  2026), redondeados, y la dirección dice «de ejemplo».
- **D12 — El agente de una clínica no diagnostica**: sus instrucciones le
  prohíben diagnosticar, recetar o decidir el tratamiento, y sus reglas de
  escalado pasan a una persona ante señales de urgencia (hinchazón, fiebre,
  sangrado, golpe, dificultad para tragar o respirar).
- **D13 — Los rubros también se cargan en el VPS**: la imagen trae
  `seed-industry.mjs` además de `seed-demo.mjs`, así que en una instancia
  instalada basta
  `sudo docker compose -p into-sales-<cliente> exec app node seed-industry.mjs dental`
  (con `--reset` u `--overwrite-agent` igual que en local).

## Ampliación del 2026-11-07: profesionales de la clínica dental

**Input**: Juan Carlos el 2026-11-07: «en la carga de datos para dental, agrega
los profesionales a los que se les va a agendar las citas, mínimo 10». Usa la
agenda con profesionales de la spec [1029](../1029-agenda-resources/spec.md).

- **D14 — Un rubro puede traer su agenda**: el horario del negocio, la duración
  de la cita, el modo del agente y sus profesionales, cada uno con su horario
  dentro del horario del negocio (1029, AC3). El horario del negocio solo se
  escribe si la agenda nunca se configuró, igual que el perfil del agente (D6).
  Un profesional solo se agrega si no hay uno activo con el mismo nombre, así
  que repetir el comando no duplica.
- **D15 — La clínica dental trae 10 profesionales**: tres de endodoncia, dos de
  odontología general y uno por cada especialidad (odontopediatría, ortodoncia,
  periodoncia, cirugía bucal y rehabilitación oral), con horarios escalonados de
  lunes a sábado. El modo es «primero libre»: Clara agenda con quien pida el
  paciente o elige según lo que pide, sin suponer un diagnóstico. El
  conocimiento trae la lista del equipo.
- **D16 — `--reset` también quita a los profesionales del rubro**, por nombre.
  Uno que ya tiene citas se archiva en vez de borrarse, porque la agenda no
  borra (1029).
- **AC10** — En una instancia nueva, `seed-industry.mjs dental` deja 10
  profesionales activos y el horario de lunes a viernes de 8:00 a 18:00 y
  sábados de 8:00 a 14:00, con citas de 60 minutos. Repetirlo agrega 0.
  `--reset` los quita, salvo los que tienen citas, que quedan archivados.

# 029 — A quién llamar hoy

**Created**: 2026-10-15

**Status**: Especificada antes de escribir código. Implementada; gates, pruebas
contra PostgreSQL y E2E en verde.

**Input**: plan de la semana 2 de IntoSales, pedido de Juan Carlos: «lista
diaria "a quién llamar hoy" por vendedor». La spec 022 la dejó fuera a
propósito («Tareas del día… se apoya en esta»).

**Carril**: ciclo completo (Principio VI). Añade dos columnas a `lead`
(migración aditiva `0021`) y cambia el contrato interno del `PATCH` del lead
(dos campos nuevos). Plan en [plan.md](plan.md), tareas en [tasks.md](tasks.md).

## Problema

Con el reparto de la 022 cada vendedor sabe qué leads son suyos, pero no qué
hacer con ellos hoy. Los seguimientos viven en la cabeza o en un cuaderno, y el
lead que dijo «llámame el jueves» se enfría porque el jueves nadie se acordó.

## Historias

**H1 — El vendedor abre «Hoy» y sabe a quién llamar.** Ve, en este orden, los
seguimientos que se le pasaron, los de hoy y los leads nuevos a los que nadie
les ha escrito todavía.

**H2 — Anota cuándo volver a llamar.** En el cajón del trato fija la fecha del
próximo contacto (y una nota corta), o la elige con un toque: mañana, en 3
días, en una semana.

**H3 — Marca que ya llamó.** Desde «Hoy», «Hecho» le pide cuándo vuelve a
tocar (o «sin fecha») y el lead sale de la lista.

**H4 — El supervisor ve la lista de cualquiera.** Elige un vendedor, «Sin
asignar» o «Todos».

## Decisiones

**D1 — Próximo contacto es una fecha del lead**, no una tarea aparte:
`follow_up_on` (día, sin hora) y `follow_up_note` (hasta 200 caracteres). Un
lead tiene a lo más un próximo contacto; para varias tareas por lead haría falta
otra tabla, y el MVP no lo pide.

**D2 — «Hoy» es el día del negocio**, en la zona de Ajustes → Agenda (la misma
que usa Resultados, 019), no la del navegador de quien mira. Sin agenda, `America/Lima`.

**D3 — Qué entra en «Hoy»**, solo leads en una etapa abierta (ni ganados ni
perdidos), de contactos no archivados y fuera del Laboratorio:

| Sección | Regla | Orden |
|---|---|---|
| **Vencidos** | `follow_up_on` antes de hoy | Lo más atrasado primero; luego prioridad alta, media, baja, sin prioridad |
| **Para hoy** | `follow_up_on` es hoy | Prioridad; luego nombre |
| **Sin primer contacto** | Sin fecha de seguimiento y el negocio nunca le escribió (ningún mensaje saliente en sus conversaciones reales) | Lo más antiguo primero |

Cada sección muestra hasta 200 y dice cuántos hay en total.

**D4 — Quién ve qué (022).** Un vendedor ve solo sus leads. Un supervisor ve
por defecto «Todos» y puede elegir un vendedor o «Sin asignar». El vendedor no
tiene selector.

**D5 — «Hecho».** Abre cuatro opciones: «Mañana», «En 3 días», «En una
semana» y «Sin fecha». Guarda la nueva fecha (días contados desde hoy del
negocio) y conserva la nota si la había. El lead sale de «Hoy» al instante.
«Hecho» no mueve la etapa ni escribe nada en la conversación.

**D6 — Desde cada fila se llama y se escribe.** «Llamar» abre `tel:` si el
contacto tiene teléfono; «Conversación» abre su hilo en la Bandeja si tiene
uno; el nombre abre el trato en el Pipeline.

**D7 — En el menú, «Hoy» va primero en Trabajo**: es lo que un vendedor abre
al empezar el día.

## Comportamiento observable y criterios de aceptación

- **AC1** — En el cajón del trato se fija, cambia o quita el próximo contacto y
  su nota; el `PATCH` del lead acepta `followUpOn` (`AAAA-MM-DD` o `null`) y
  `followUpNote` (hasta 200 o `null`). Una fecha inválida responde 422.
- **AC2** — «Hoy» muestra las tres secciones de D3 con sus conteos, en el día
  del negocio.
- **AC3** — Un lead ganado o perdido, o de un contacto archivado, no aparece.
- **AC4** — Un lead al que el negocio ya le escribió y que no tiene fecha no
  aparece en «Sin primer contacto».
- **AC5** — Un vendedor solo ve sus leads; un supervisor elige vendedor, «Sin
  asignar» o «Todos» (D4). Un vendedor que pide la lista de otro recibe la
  suya.
- **AC6** — «Hecho» con «Mañana» deja la fecha en hoy + 1 y saca el lead de la
  lista; con «Sin fecha» la quita.
- **AC7** — «Hoy» se usa a 360 px sin scroll horizontal.

## Qué se decidió NO hacer y por qué

- **Recordatorios por correo o notificación**: la instancia no manda correos
  (Principio II); la lista se abre al empezar el día.
- **Varias tareas por lead o tareas sin lead**: es un gestor de tareas, no lo
  pide el MVP (D1).
- **Hora del seguimiento**: el vendedor organiza su día; con el día basta.
- **Marcar la llamada como actividad en la bitácora**: sería un modelo nuevo
  de actividades; «Hecho» solo reprograma.

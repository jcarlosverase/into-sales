# Feature Specification: Reparto de leads por vendedor

**Feature Branch**: `feat/intosales`

**Created**: 2026-10-10

**Status**: Especificada antes de escribir código.

**Input**: MVP de IntoSales, prioridad 1: «cada lead tiene un vendedor, el
vendedor solo ve sus leads y el lead nuevo va al siguiente vendedor por
turno». Pedido de Juan Carlos el 2026-10-10.

**Carril**: ciclo completo (Principio VI). Añade columnas a `lead` y dos tablas
nuevas (migración `0017`), y cambia lo que devuelven varias rutas internas
según quién pregunta ([contracts/api.md](contracts/api.md)).

## Contexto

Hoy todo el equipo ve todos los leads y todas las conversaciones. En una
academia con tres asesoras eso significa que dos contestan al mismo prospecto,
o que ninguna lo hace porque cree que lo tomó otra. El MVP promete que
**ningún lead se pierde y cada vendedor sabe a quién atender**, y para eso cada
lead necesita un dueño.

## Decisiones

- **D1 — Vendedor es el rol `member`.** El `owner` y el `admin` son
  supervisores: ven todo, asignan y configuran el reparto. No se crea un rol
  nuevo: el equipo ya se da de alta como `member` (Ajustes → Equipo).
- **D2 — Un vendedor por lead.** La asignación vive en el lead. El contacto y
  sus conversaciones siguen al lead: quien tiene el lead ve la conversación.
- **D3 — Reparto por turno (round robin).** Cada lead nuevo va al siguiente
  vendedor de la lista, en el orden en que entraron al equipo. El turno se
  guarda en la base y se toma con un bloqueo de fila, para que dos mensajes
  simultáneos no le den el mismo turno a la misma persona.
- **D4 — El reparto viene encendido.** Un supervisor puede apagarlo, y puede
  sacar a un vendedor del turno («Recibe leads nuevos») sin quitarle los que
  ya tiene, por ejemplo en vacaciones.
- **D5 — Sin vendedores disponibles, el lead queda «Sin asignar».** Solo los
  supervisores lo ven. Así un negocio de una persona (solo el dueño) funciona
  igual que hoy.
- **D6 — La captura manual respeta a quien la hace.** Un vendedor que da de
  alta un prospecto se lo queda; si lo da de alta un supervisor, entra al
  turno como cualquier otro lead.
- **D7 — Solo los supervisores reasignan.** Reasignar a mano no mueve el
  turno.
- **D8 — Lo ajeno no existe para el vendedor.** Un lead, contacto o
  conversación que no es suyo responde 404, no 403: no se confirma que exista.
- **D9 — Sin relleno de datos viejos.** Los leads que ya existen quedan sin
  asignar; el supervisor los reparte desde el tablero. Asignarlos solos con
  el turno repartiría también los cerrados y perdidos.
- **D10 — Si se borra un usuario, sus leads quedan sin asignar** (la llave
  foránea pasa a `NULL`), en vez de desaparecer o quedar con un dueño
  inexistente.

- **D11 — Citas también por vendedor** (ampliación del 2026-10-15, pedida por
  Juan Carlos: «el vendedor solo ve sus leads»). Con la agenda encendida, un
  vendedor ve en Citas solo las citas de sus contactos, más los bloqueos del
  calendario (no tienen contacto y dicen cuándo no hay lugar). Agendar,
  reprogramar, cancelar o marcar una cita de un contacto ajeno responde 404.
  Los supervisores ven y tocan todas.
- **D12 — Resultados no muestra nombres ajenos** (misma ampliación). Los
  números de ventas, agente y anuncios de Resultados siguen siendo del negocio
  entero; la sección de higiene, que es una lista de pendientes con nombres
  («leads en silencio», con su conteo y su dinero, y «ventanas por vencer»),
  para un vendedor trae solo a sus contactos. Los mensajes fallidos van
  agrupados por motivo, sin nombres, y no cambian.

## Comportamiento observable y criterios de aceptación

**Asignación por turno**

- **AC1** — Con el reparto encendido y dos vendedores A y B (A entró primero),
  tres leads nuevos quedan asignados a A, B y A, en ese orden.
- **AC2** — Un vendedor con «Recibe leads nuevos» apagado no recibe leads por
  turno y conserva los que ya tenía.
- **AC3** — Con el reparto apagado, o sin vendedores que reciban leads, el
  lead nuevo queda sin asignar.
- **AC4** — El lead que crea el webhook (WhatsApp, Instagram o Messenger) y el
  que crea la captura manual de un supervisor siguen la misma regla.
- **AC5** — El lead que da de alta un vendedor queda asignado a ese vendedor.

**Visibilidad**

- **AC6** — Un vendedor solo ve en la Bandeja, el Pipeline y Contactos los
  leads asignados a él, con sus conversaciones.
- **AC7** — Un vendedor que pide por URL o API un lead, contacto, conversación,
  mensaje o adjunto que no es suyo recibe 404.
- **AC8** — Un vendedor no recibe en tiempo real (SSE) mensajes ni cambios de
  conversaciones que no son suyas.
- **AC9** — Los supervisores ven todo, incluidos los leads sin asignar.

**Reasignar y configurar**

- **AC10** — En el cajón del trato, un supervisor ve el vendedor asignado y
  puede cambiarlo o dejarlo sin asignar. El vendedor ve a quién está asignado,
  sin poder cambiarlo.
- **AC11** — Reasignar a un usuario que no es del equipo responde 422.
- **AC12** — Un vendedor que intenta reasignar recibe 403.
- **AC13** — En Ajustes → Equipo, un supervisor enciende o apaga el reparto y
  marca quién recibe leads nuevos. Un vendedor ve la sección sin poder
  cambiarla.
- **AC14** — Las tarjetas del Pipeline muestran las iniciales del vendedor
  asignado, o «Sin asignar».

**Ampliación del 2026-10-15 (D11, D12)**

- **AC15** — Con la agenda encendida, `GET /api/bookings` (con y sin rango)
  devuelve a un vendedor solo las citas de sus contactos y los bloqueos; a un
  supervisor, todas.
- **AC16** — Un vendedor que agenda, reprograma, cancela o marca una cita de un
  contacto ajeno recibe 404.
- **AC17** — En la higiene de Resultados, un vendedor solo ve en «leads en
  silencio» y «ventanas por vencer» a sus contactos.

## Alcance

**Entra**: asignación en el lead, reparto por turno, visibilidad por vendedor
en Bandeja, Pipeline, Contactos, adjuntos y SSE, reasignación manual, y la
sección «Reparto de leads» en Ajustes → Equipo.

**Fuera de alcance a propósito**:

| Qué | Por qué no |
|---|---|
| Tareas del día («a quién llamar hoy») | Es otra función del MVP; se apoya en esta. |
| Importar contactos desde CSV | Otra función del MVP. |
| Regla «IA solo fuera de horario» | Otra función del MVP. |
| Laboratorio filtrado por vendedor; números de Resultados por vendedor | El Laboratorio no tiene contactos reales. Resultados por vendedor es su propia función. (Citas y los nombres de Resultados se cerraron en la ampliación del 2026-10-15: D11, D12.) |
| Filtro por vendedor en el tablero del supervisor | Útil, pero no es parte de la promesa; las iniciales en la tarjeta bastan para empezar. |
| Repartir por carga, por horario o por habilidad | El turno simple es lo que pide el MVP. |
| Avisar al vendedor (correo, push) cuando le llega un lead | La instancia no manda correos (Principio II); el lead aparece en su Bandeja en vivo. |
| Reasignar en lote | Se hace uno por uno desde el cajón. |

## Riesgos y supuestos (Principio VII)

- **Supuesto**: los supervisores también venden a veces, pero no entran al
  turno. Si un negocio quiere que el dueño reciba leads por turno, hoy tendría
  que crear una segunda cuenta como vendedor. Revisar con el primer piloto.
- **Riesgo**: un vendedor con la Bandeja abierta al momento de una
  reasignación sigue viendo esa conversación hasta recargar; el servidor ya le
  niega mensajes y envíos (404).

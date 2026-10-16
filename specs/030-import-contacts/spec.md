# 030 — Importar contactos desde Excel o CSV

**Created**: 2026-10-15

**Status**: Especificada antes de escribir código. Implementada; gates, pruebas
contra PostgreSQL y E2E en verde.

**Input**: plan de la semana 2 de IntoSales, pedido de Juan Carlos: «importar
contactos desde Excel o CSV». La spec 022 la dejó fuera a propósito.

**Carril**: ciclo completo (Principio VI). No toca el modelo de datos, pero
añade dos rutas internas nuevas y una regla de normalización de teléfonos que
otras pantallas no tienen. Plan en [plan.md](plan.md), tareas en
[tasks.md](tasks.md).

## Problema

Un negocio que empieza con IntoSales ya tiene su cartera en una hoja de
cálculo: los interesados de la feria, los alumnos del año pasado, la lista que
le pasó la agencia. Darlos de alta de uno en uno es una tarde perdida, y sin
ellos el CRM empieza vacío.

## Historias

**H1 — Sube su hoja.** En Contactos, «Importar» acepta un `.xlsx` o un `.csv`.
**H2 — Revisa antes de importar.** Ve qué columna es el nombre, cuál el
teléfono y cuál las notas (las adivina por el encabezado y se pueden cambiar),
y una vista previa: cuántos entran, cuántos ya existen, cuántos repetidos en el
archivo y cuántos con teléfono inválido, con ejemplos.
**H3 — Importa.** Al confirmar, entran los nuevos con su lead, y ve el resumen
con el detalle de lo que no entró (número de fila y motivo).

## Decisiones

**D1 — Formatos.** `.xlsx` (la primera hoja) y `.csv` (separado por coma o
punto y coma, que es lo que guarda Excel en español; UTF-8 o Latin-1). Hasta
2 MB y 2 000 filas por archivo. Sin dependencias nuevas: el CSV se lee a mano
y el `.xlsx` (un zip con XML) con `node:zlib` (Principio II: lo mínimo).

**D2 — Columnas.** Nombre, Teléfono (obligatoria) y Notas, y opcionalmente
Etapa. Se adivinan por el encabezado sin tildes ni mayúsculas (`nombre`,
`cliente`, `name` · `telefono`, `celular`, `whatsapp`, `movil`, `phone` ·
`notas`, `comentario`, `observaciones` · `etapa`, `estado`). Si no hay nombre,
el contacto se llama como su teléfono. Una etapa que no coincide con una
abierta del tablero se ignora (el lead va a la primera).

**D3 — Teléfonos con código de país, como el alta manual.** Se quitan
espacios, guiones, paréntesis, el `+` y el `00` inicial. Un número de 10
dígitos o menos se toma como local y se le antepone el **código de país del
importador** (un campo de la vista previa; por defecto 51 si la moneda del
negocio es PEN, 52 si es MXN, 57 COP, 56 CLP, 54 ARS, 1 USD; si no, vacío y
entonces esos números no entran). Luego aplica la misma normalización del alta
manual (`521…` → `52…`) y debe quedar en 7 a 15 dígitos; si no, «teléfono
inválido».

**D4 — Nunca duplica ni pisa.** Un teléfono que ya es contacto del negocio se
salta («ya existe») y no se modifica; uno repetido dentro del archivo entra una
sola vez (la primera fila). Por eso importar el mismo archivo dos veces no crea
nada la segunda vez (Principio IV).

**D5 — A quién van los leads (022).** Un vendedor que importa se queda con los
leads (como en su alta manual, 022 D6). Un supervisor elige: **repartir por
turno** (por defecto), **asignar a** un vendedor, o **sin asignar**.

**D6 — Dos pasos sin guardar el archivo.** La vista previa y la importación
reciben el mismo archivo; el servidor no lo guarda entre una y otra (ni en
disco ni en la base). La importación vuelve a validar todo.

## Criterios de aceptación

- **AC1** — «Importar» en Contactos acepta `.xlsx` y `.csv` (coma o punto y
  coma, UTF-8 o Latin-1); otro formato, más de 2 MB o más de 2 000 filas se
  rechazan con su motivo, sin importar nada.
- **AC2** — La vista previa adivina las columnas por el encabezado, deja
  cambiarlas y muestra los conteos de D3–D4 con hasta 20 filas de ejemplo.
- **AC3** — Un número local recibe el código de país elegido; uno sin código y
  sin código elegido, o fuera de 7–15 dígitos, queda como «teléfono inválido»
  con su número de fila.
- **AC4** — Al importar, cada contacto nuevo entra con su lead en la etapa
  indicada o en la primera abierta; los que ya existían no cambian; repetir la
  importación no crea nada.
- **AC5** — Un vendedor que importa se queda con los leads; un supervisor los
  reparte por turno, a un vendedor o sin asignar (D5).
- **AC6** — El diálogo se usa a 360 px sin scroll horizontal.

## Qué se decidió NO hacer y por qué

- **Actualizar contactos existentes desde el archivo**: pisar notas o nombres
  sin ver qué cambia es peligroso; se hace a mano.
- **Exportar**: es otra función.
- **`.xls` (Excel 97)**: formato binario viejo; se guarda como `.xlsx` o `.csv`
  desde cualquier Excel.
- **Mandar un WhatsApp a los importados**: escribir primero exige plantilla
  aprobada y es una decisión aparte (Principio VIII: nada de difusión masiva).

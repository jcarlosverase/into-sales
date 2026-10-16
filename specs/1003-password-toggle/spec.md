# 1003 — Mostrar u ocultar la contraseña

**Created**: 2026-10-16

**Status**: Especificada antes de escribir código. Implementada; pruebas y E2E
(`passwordToggleChecks`, a 360 px) en verde.

**Input**: pedido de Juan Carlos el 2026-10-16: «agrega el botón para
mostrar/ocultar la contraseña ingresada».

**Carril**: ligero. Solo cambia la interfaz de dos pantallas.

## Problema

Al iniciar sesión o crear la cuenta, sobre todo desde el celular, un error de
tipeo en la contraseña no se ve: hay que borrarla y volver a escribirla sin
saber qué estuvo mal.

## Comportamiento observable y criterios de aceptación

- **AC1** — En «Entrar» y en «Crear la cuenta inicial», el campo de contraseña
  trae un botón con un ojo. Al tocarlo, la contraseña se ve como texto; al
  volver a tocarlo, se oculta de nuevo. Empieza oculta.
- **AC2** — El botón no envía el formulario, y para los lectores de pantalla
  dice «Mostrar contraseña» u «Ocultar contraseña» según el estado
  (`aria-pressed`).
- **AC3** — Se usa a 360 px sin scroll horizontal, y el botón se toca bien
  (36 px).

## Qué se decidió NO hacer y por qué

- **Los tokens y llaves de Ajustes** (WhatsApp, IA, Zernio, central) siguen
  ocultos y sin el botón: son secretos que se pegan una vez, no una contraseña
  que se escribe, y no deben quedar a la vista en pantalla.
- **Recordar si se dejó visible**: cada vez que se abre la pantalla empieza
  oculta. Es lo seguro en un equipo compartido.

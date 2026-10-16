# 1004 — Página de salud del CRM

**Created**: 2026-10-16

**Status**: Especificada antes de escribir código. Implementada; pruebas unitarias,
de integración y E2E (`healthPageChecks`, a 360 px) en verde.

**Input**: pedido de Juan Carlos el 2026-10-16: «cada aplicación debe tener
su propia página de estado de salud, donde verifique su conexión a base de
datos y otros servicios importantes». Su gemela en into-central es la spec 007.

**Carril**: ligero. No toca el modelo de datos ni un contrato. Agrega una
pantalla que reúne los chequeos que ya existen: los del doctor (`pnpm doctor`)
y los del latido al central (028).

## Problema

Hoy, saber si el CRM está bien pide una terminal: `pnpm doctor` o mirar el
registro. Quien administra el negocio no tiene dónde ver que la base responde,
que el token de WhatsApp sigue válido o que la IA tiene saldo, hasta que algo
falla delante de un cliente.

## Comportamiento observable y criterios de aceptación

- **AC1** — «Ajustes → Sistema → Salud» (`/settings/health`) corre los
  chequeos al abrirla. Cada uno dice en verde, ámbar, rojo o gris si está
  bien, con aviso, mal u omitido, con su detalle y, cuando no está bien, qué
  hacer:
  - **Base de datos**: responde, en cuántos milisegundos, qué versión.
  - **Migraciones**: todas aplicadas o cuántas faltan.
  - **Archivos**: si `MEDIA_DIR` se puede escribir (adjuntos, logo, icono).
  - **WhatsApp**: una prueba real del token de cada número contra Meta, la
    misma del doctor; omitido si no hay número.
  - **Inteligencia artificial**: si hay llave y si el proveedor la aceptó
    (sin gastar tokens); omitido si no está configurada.
  - **Cerebro externo**: el despacho (`BRAIN_DISPATCH_URL`) y su `/health`
    (`BRAIN_HEALTH_URL`); omitido si no hay cerebro.
  - **Servicio central de into**: si late y qué respondió la última vez;
    omitido si la bandera está apagada.
- **AC2** — Arriba, un resumen («Todo en orden», o cuántos fallan o avisan) y
  la hora de la verificación en la zona del negocio. «Verificar de nuevo»
  repite los chequeos.
- **AC3** — Nunca muestra secretos: ni la URL de la base con su contraseña, ni
  tokens; de una llave, a lo más los últimos 4.
- **AC4** — Un chequeo que no se puede correr no tumba la página: sale en rojo
  con su motivo. Con la base caída, lo que depende de ella se omite.
- **AC5** — Solo la ven el propietario y los administradores, y se usa a
  360 px sin scroll horizontal.

## Qué se decidió NO hacer y por qué

- **Exponer este detalle en `/api/health`**: esa ruta es pública, la usa el
  healthcheck de Docker y dice solo si la base responde. El detalle se queda
  detrás de la sesión.
- **Probar la IA con una petición de verdad**: gasta tokens. Para eso está
  «Probar conexión» en Ajustes → IA; aquí se muestra lo que el proveedor
  respondió la última vez.
- **Los canales por Zernio**: ya tienen su pantalla, «Canales → Estado».

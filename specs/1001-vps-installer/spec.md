# 1001 — Instalador en un comando para un VPS

**Created**: 2026-10-15

**Status**: Especificada antes de escribir código. Implementada; probada en
esta Mac (dos instancias y el central detrás del Caddy compartido, en
puertos de prueba) y la parte de sistema en un Ubuntu 24.04 limpio. Falta la
primera corrida en el VPS real.

**Input**: pedido de Juan Carlos el 2026-10-15: «prepara el instalador en un
comando, separado para into-sales y into-central, porque ya voy a comprar el
VPS y dominio».

**Carril**: ligero. No toca el modelo de datos ni un contrato de la app:
agrega `deploy/install.sh` y una capa de compose. Corrige además un hueco de
la Ruta B: `docker-compose.yml` no le pasaba `INTO_CENTRAL_URL` a la app, así
que el latido de la 028 nunca se encendía con compose.

## Problema

Instalar el CRM en un VPS hoy son varios pasos a mano: instalar Docker,
clonar, generar cinco secretos, escribir el `.env`, levantar el compose y
revisar el HTTPS. Además, el compose de la Ruta B trae su propio Caddy en
los puertos 80 y 443, así que en un mismo VPS no caben dos CRMs ni el CRM
junto al servicio central de into.

## Comportamiento observable y criterios de aceptación

- **AC1 — Un comando.** En un Ubuntu o Debian recién creado,
  `curl -fsSL …/deploy/install.sh | sudo bash -s -- --client acme --domain crm.acme.com`
  instala lo que falte (paquetes, Docker y 2 GB de swap si hay menos de 3,5 GB
  de memoria y no hay swap; abre 80 y 443 si `ufw` está activo), construye la
  imagen desde el código, la arranca y deja el CRM en `https://<dominio>`.
  Termina diciendo la dirección y los pasos que siguen: crear la cuenta en
  `/register` y conectar WhatsApp.
- **AC2 — Valida antes de tocar nada.** Un dominio, cliente, URL del
  central, rama, puertos o `--env` inválidos, un cliente que no está
  instalado al actualizar o desinstalar, o una opción desconocida, terminan
  con un mensaje claro antes de instalar o escribir algo. Las opciones están
  en inglés (cambio del 2026-10-17, pedido de Juan Carlos).
- **AC3 — Varias instancias y el central en el mismo VPS.** El HTTPS lo da un
  solo Caddy compartido, `into-edge`, en `/opt/into-edge`. Lo crea el primer
  instalador que corre, sea este o el de into-central, y cada app deja su
  archivo en `sites/`. Cada instancia es un cliente (`--client`, por
  defecto `principal`) y tiene su carpeta
  (`/opt/into-sales/<cliente>`), su proyecto de compose
  (`into-sales-<cliente>`), su Postgres con la base `into_sales` y sus
  volúmenes. Un dominio que ya usa otra instancia se rechaza (cambio del
  2026-10-17).
- **AC3b — La base se llama como la del central.** `into_sales` aquí e
  `into_central` en el central, sin rastro de «vocero». Un volumen que todavía
  tiene la base `vocero` se renombra una vez, con la app parada, la primera
  vez que se vuelve a correr el instalador (cambio del 2026-10-17).
- **AC4 — Actualizar.** `--update --client acme` trae el código de la rama,
  vuelve a construir y arrancar, sin reinstalar paquetes, y las migraciones
  corren al arrancar, como siempre. Volver a correr la instalación hace lo
  mismo. Los secretos del `.env` se generan una sola vez y nunca se pisan. El
  dominio sale del `.env` si no se pasa `--domain`, y se reescribe si se
  pasa. El central solo cambia si se pasa `--central` o `--no-central`: volver a
  correr el instalador sin ellas conserva el que ya estaba (cambio del
  2026-10-16, pedido de Juan Carlos).
- **AC5 — Secretos.** El `.env` queda con permisos 600 y el instalador no
  imprime ningún secreto. Con un repositorio privado, `GITHUB_TOKEN` se usa
  solo para clonar y no se guarda en ningún archivo, tampoco en `.git/config`.
- **AC6 — El central es opcional.** `--central https://api.into.center`
  enciende el latido (028) y `--no-central` lo apaga. En la primera
  instalación, sin ninguna de las dos, queda apagado.
- **AC7 — DNS y puertos.** Si el dominio no apunta al servidor, el
  instalador avisa sin detenerse: Caddy saca el certificado solo cuando el
  DNS llega. Si los puertos 80 y 443 ya los usa otro programa (Coolify,
  nginx, la Ruta B), se detiene y lo dice.
- **AC8 — Variables opcionales.** `--env CLAVE=valor` (repetible) fija en el
  `.env` una variable que el `docker-compose.yml` le pasa a la app, como
  `AGENDA=on`; `CLAVE=` la vacía. Rechaza las que maneja el instalador
  (secretos, dominio, central) y las que el compose no lee, porque no
  tendrían efecto (cambio del 2026-10-17).
- **AC9 — Desinstalar.** `--uninstall --client acme` pide escribir el nombre
  del cliente (o `--yes`), respalda en `/opt/into-backups/into-sales-<cliente>-<fecha>/`
  la base (`pg_dump`), los archivos subidos y el `.env`, y después quita
  contenedores, volúmenes, imagen, su sitio de Caddy y su carpeta. Si el
  respaldo falla, no borra nada. Si no queda ninguna app, también quita el
  Caddy compartido y su red. `--no-backup` se salta el respaldo (cambio del
  2026-10-17).

## Constitución

- **II (soberanía):** no agrega ninguna dependencia de la app. Docker sale
  de get.docker.com, el instalador oficial.
- **I (seguridad):** cubierto por AC5.
- **IV (idempotencia):** cubierto por AC4.
- **Ruta B:** queda igual. `docker-compose.yml` sigue trayendo su propio
  Caddy, que la capa del instalador apaga con un perfil.

## Qué se decidió NO hacer y por qué

- **Respaldos automáticos de la base.** Es otra decisión: dónde se guardan
  y por cuánto tiempo. Por ahora queda `docker compose exec postgres pg_dump`.
- **Usar la imagen publicada.** La de GHCR viene del repositorio original:
  el instalador siempre construye desde el código de esta copia.
- **Otras distribuciones (CentOS, Alpine).** Ubuntu y Debian cubren los VPS
  de siempre.
- **Coolify.** Si el VPS tiene Coolify, se usa su propia ruta, porque su
  proxy ya ocupa los puertos 80 y 443 (AC7).

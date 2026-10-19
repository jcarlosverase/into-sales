# Instalar en un VPS con un comando

Spec [1001](../specs/1001-vps-installer/spec.md). Sirve para un VPS con
Ubuntu o Debian (recomendado: Ubuntu 24.04). Uno de 2 vCPU y 4 GB alcanza para
el central y unos cuantos CRMs. Todas las opciones del instalador:
`curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh | bash -s -- --help`.

## 1. Apunta los dominios

Antes de instalar, crea en el DNS un registro **A** hacia la IP del VPS para
cada dominio:

| Dominio | Para qué |
|---|---|
| `crm.cliente.com` | Un CRM (uno por cliente) |
| `central.into.center` | El panel del servicio central |
| `api.into.center` | La API del central para los CRMs |

Si el DNS todavía no llega, el instalador avisa y sigue igual. Caddy saca el
certificado solo cuando el dominio apunte al servidor.

## 2. El servicio central (una vez)

Su instalador vive en el repositorio privado `into-central`. Mira su guía en
`docs/deployment.md` (Ruta instalador).

## 3. Un CRM por cliente

Cada cliente se instala con su nombre corto (`--client`, en minúsculas, con
números y guiones) y su dominio. En el mismo VPS caben los que quieras: todos
comparten el Caddy (los puertos 80 y 443) y cada uno tiene su carpeta, su
proyecto de compose, su Postgres y sus volúmenes.

```bash
curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh | sudo bash -s -- --client acme --domain crm.acme.com --central https://api.into.center
```

| Opción | Qué hace |
|---|---|
| `--client` | Cliente de la instancia. Por defecto: `principal` |
| `--domain` | Dominio del CRM. Obligatorio al instalar; al actualizar se conserva |
| `--central` | Enciende el latido al central. Se conserva al actualizar |
| `--no-central` | Apaga el latido al central |
| `--env CLAVE=valor` | Fija una variable opcional (se puede repetir). Ver [Variables de entorno](#variables-de-entorno) |
| `--branch` | Rama del repositorio. Por defecto: `main` |
| `--update` | Actualiza un cliente ya instalado |
| `--uninstall` | Quita al cliente por completo, después de respaldarlo |
| `--yes` | Desinstala sin pedir confirmación |
| `--no-backup` | Desinstala sin respaldar |

Al terminar, el instalador dice qué sigue:

1. Abrir `https://crm.acme.com/register` y crear la cuenta del negocio.
2. Conectar WhatsApp y la IA en Ajustes.
3. En Ajustes → Plan, pegar la llave de licencia que da el central.

**Otro cliente en el mismo VPS**: el mismo comando con otro `--client` y
otro `--domain`.

```bash
curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh | sudo bash -s -- --client beta --domain crm.beta.com --central https://api.into.center
```

**Con módulos opcionales desde el inicio:**

```bash
curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh | sudo bash -s -- --client gamma --domain crm.gamma.com --central https://api.into.center --env AGENDA=on --env CHANNELS=whatsapp,instagram
```

## Cómo queda el servidor

```text
/opt/into-edge/              Caddy compartido: HTTPS de todos los dominios
  sites/into-sales-acme.caddy
  sites/into-sales-beta.caddy
  sites/into-central.caddy
/opt/into-sales/acme/        .env (secretos, 600) y src/ (el código)
/opt/into-sales/beta/
/opt/into-central/
```

| | Un cliente (`acme`) | El central |
|---|---|---|
| Proyecto de compose | `into-sales-acme` | `into-central` |
| Base de datos | `into_sales`, en su propio Postgres | `into_central` |
| Volúmenes | `into-sales-acme_sales_pg` y `into-sales-acme_sales_app_data` | `into-central_central_pg` |

Todas las apps comparten la red `into_edge` con el Caddy, así que ningún
cliente necesita puertos propios. Las bases de antes de 2026-10-17 se
llamaban `vocero` (y `central` en el central): el instalador las renombra
solo la primera vez que corres `--update`.

## Actualizar

`--update` trae el código, construye y arranca, sin reinstalar paquetes, y las
migraciones corren al arrancar. Los secretos nunca se pisan, y lo que no
repitas (`--domain`, `--central`, las variables de `--env`) se conserva.

```bash
curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh | sudo bash -s -- --update --client acme
```

Todos los clientes del VPS:

```bash
for c in $(ls /opt/into-sales); do curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh | sudo bash -s -- --update --client "$c" || break; done
```

Con cambios:

```bash
curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh | sudo bash -s -- --update --client acme --domain ventas.acme.com   # otro dominio
curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh | sudo bash -s -- --update --client acme --env AGENDA=on            # enciende la agenda
curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh | sudo bash -s -- --update --client acme --env AGENDA=              # la apaga
curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh | sudo bash -s -- --update --client acme --no-central               # apaga el latido
```

## Desinstalar

Pide escribir el nombre del cliente para confirmar. Antes de borrar, respalda
en `/opt/into-backups/into-sales-acme-<fecha>/` la base (`into_sales.sql`),
los archivos subidos (`app-data.tar.gz`) y el `.env`; si el respaldo falla, no
borra nada. Después quita contenedores, volúmenes, imagen, su sitio de Caddy y
`/opt/into-sales/acme`. Si ya no queda ninguna app, también quita el Caddy
compartido.

```bash
curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh | sudo bash -s -- --uninstall --client acme
```

Sin confirmación: `--yes`. Sin respaldo (los datos se pierden): `--no-backup`.
Todos los clientes del VPS:

```bash
for c in $(ls /opt/into-sales); do curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh | sudo bash -s -- --uninstall --client "$c" --yes || break; done
```

Docker y los paquetes del sistema se quedan. Copia `/opt/into-backups` fuera
del VPS antes de borrarlo.

## Variables de entorno

Nadie escribe el `.env` a mano: el instalador lo crea en
`/opt/into-sales/<cliente>/.env` (permisos 600).

| Variable | De dónde sale | Valor por defecto |
|---|---|---|
| `POSTGRES_PASSWORD` | La genera el instalador la primera vez y nunca la vuelve a tocar | Aleatoria (48 caracteres hexadecimales) |
| `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` | Igual | Aleatorias (base64 de 32 bytes) |
| `META_WEBHOOK_VERIFY_TOKEN` | Igual | Aleatoria (64 caracteres hexadecimales) |
| `DOMAIN` | `--domain` | Ninguno: es obligatorio al instalar |
| `APP_BASE_URL` | Sale de `--domain` | `https://<dominio>` |
| `INTO_CENTRAL_URL` | `--central`; `--no-central` la vacía | Vacía: latido apagado |
| `METRICS_TOKEN` | La pone el instalador si el VPS tiene el monitoreo de into | Vacía: sin monitoreo |
| `EDGE_ALIAS` | La pone el instalador | `into-sales-<cliente>-app` |
| `APP_IMAGE` | La pone el instalador | `into-sales:<cliente>` |

Las opcionales se fijan con `--env` y están apagadas si no se ponen. El
instalador solo acepta las que el `docker-compose.yml` le pasa a la app:

| Variable | Para qué | Valor por defecto | Ejemplo |
|---|---|---|---|
| `CHANNELS` | Canales además de WhatsApp | Vacía: solo WhatsApp | `--env CHANNELS=whatsapp,instagram,messenger,tiktok` |
| `AGENDA` | Citas y reservas del agente | Vacía: apagada | `--env AGENDA=on` |
| `ATRIBUCION` | Reporte de ventas a Meta (Conversions API) | Vacía: apagada | `--env ATRIBUCION=on` |
| `ALLOW_SIGNUP` | Reabrir el registro después de la primera cuenta | Vacía: cerrado tras la primera cuenta | `--env ALLOW_SIGNUP=true` |
| `AGENT_COALESCE_MS` | Cuánto espera el agente para juntar mensajes | `6000` | `--env AGENT_COALESCE_MS=8000` |
| `TRUSTED_ORIGINS` | Dominios extra para iniciar sesión | Vacía: solo el dominio del CRM | `--env TRUSTED_ORIGINS=https://ventas.acme.com` |
| `META_APP_SECRET` | Firma de los webhooks (developers.facebook.com → tu app → Configuración → Básica) | Vacía: no se valida la firma | `--env META_APP_SECRET=…` |
| `META_GRAPH_API_VERSION` | Versión de la API de Meta | `v25.0` | `--env META_GRAPH_API_VERSION=v25.0` |
| `BOT_API_KEY` | API para un cerebro externo (`openssl rand -base64 32`) | Vacía: `/api/bot/*` responde 401 | `--env BOT_API_KEY=…` |
| `BRAIN_HEALTH_URL`, `BRAIN_DISPATCH_URL` | Dirección interna del cerebro externo | Vacías: contesta el agente incluido | `--env BRAIN_DISPATCH_URL=http://nea:8000/dispatch` |

Las credenciales de terceros no van en el `.env`: el token de WhatsApp se pega
en Ajustes → WhatsApp, la llave de la IA en Ajustes → IA, la llave de licencia
en Ajustes → Plan, y Zoom o Google en Ajustes → Agenda. Todas se guardan
cifradas con `ENCRYPTION_KEY`. Lo que pases con `--env` queda en el historial
de la terminal; bórralo con `history -c` si era secreto.

## Del día a día

Primero di de qué cliente se trata (`ls /opt/into-sales` los lista):

```bash
CLIENT=acme
sudo docker ps --format "table {{.Names}}\t{{.Status}}"                # qué está corriendo
sudo docker compose -p into-sales-$CLIENT logs -f app                  # registro
sudo docker compose -p into-sales-$CLIENT restart app                  # reiniciar la app
sudo docker compose -p into-sales-$CLIENT exec -T postgres \
  pg_dump -U postgres into_sales > $CLIENT-$(date +%F).sql             # respaldo de la base
```

La salud del CRM (base de datos, migraciones, archivos, WhatsApp, IA, cerebro
y central) se ve en `https://crm.acme.com/settings/health`, como
propietario o administrador.

Guarda una copia del `.env` de cada cliente (`/opt/into-sales/<cliente>/.env`).
`ENCRYPTION_KEY` cifra los tokens de WhatsApp y de la IA: sin ella, hay que
volver a pegarlos.

## Registros y monitoreo

El registro de la app es un JSON por línea (spec
[1006](../specs/1006-observability/spec.md)). Para ver solo los errores:

```bash
sudo docker compose -p into-sales-principal logs app | grep '"level":"error"'
```

Cada respuesta trae `X-Request-Id`; el mismo valor sale en el registro de
Caddy (campo `uuid`) y en los errores de la app.

Si el servidor tiene el monitoreo de into (lo instala el instalador de
into-central con `--monitoring`; guía en `docs/monitoring.md` de ese repo),
cada CRM se suma a Prometheus y a Grafana al correr su instalador. Un CRM
instalado antes del monitoreo necesita volver a correr el instalador una vez;
la actualización rápida de arriba no lo suma.

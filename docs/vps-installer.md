# Instalar en un VPS con un comando

Spec [1001](../specs/1001-vps-installer/spec.md). Sirve para un VPS con
Ubuntu o Debian (recomendado: Ubuntu 24.04). Uno de 2 vCPU y 4 GB alcanza para
el central y unos cuantos CRMs. Todas las opciones del instalador:
`curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh | bash -s -- --ayuda`.

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

## 3. Un CRM

```bash
curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh | sudo bash -s -- --dominio crm.cliente.com --central https://api.into.center
```

| Opción | Qué hace |
|---|---|
| `--dominio` | Dominio del CRM (obligatorio) |
| `--nombre` | Nombre de la instancia, para tener varias en el mismo VPS. Por defecto: `principal` |
| `--central` | Enciende el latido al central. Al actualizar no hace falta repetirla: se conserva la que ya estaba |
| `--sin-central` | Apaga el latido al central |
| `--rama` | Rama del repositorio. Por defecto: `main` |

Al terminar, el instalador dice qué sigue:

1. Abrir `https://crm.cliente.com/register` y crear la cuenta del negocio.
2. Conectar WhatsApp.
3. En Ajustes → Plan, pegar la llave de licencia que da el central.

**Otro cliente en el mismo VPS:**

```bash
curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh | sudo bash -s -- --dominio crm.otro.com --nombre otro --central https://api.into.center
```

## Cómo queda el servidor

```text
/opt/into-edge/              Caddy compartido: HTTPS de todos los dominios
  sites/into-sales-principal.caddy
  sites/into-central.caddy
/opt/into-sales/principal/   .env (secretos, 600) y src/ (el código)
/opt/into-sales/otro/
/opt/into-central/
```

Cada app es su propio proyecto de compose (`into-sales-<nombre>`,
`into-central`), con su base y sus volúmenes. Todas comparten la red
`into_edge` con el Caddy.

## Actualizar

Vuelve a correr el mismo comando: trae el código, construye y arranca, y las
migraciones corren al arrancar. Los secretos nunca se pisan, y lo que no
repitas (`--central`) se conserva.

Más rápido, sin reinstalar paquetes (cambia `principal` por el `--nombre` de
la instancia):

```bash
cd /opt/into-sales/principal && sudo git -C src pull -q && C="sudo docker compose -p into-sales-principal --env-file .env -f src/docker-compose.yml -f src/deploy/docker-compose.vps.yml" && $C build --build-arg SOURCE_COMMIT=$(git -C src rev-parse HEAD) app && $C up -d
```

Todos los CRMs del VPS de una vez:

```bash
for d in /opt/into-sales/*/; do n=$(basename $d); (cd $d && sudo git -C src pull -q && C="sudo docker compose -p into-sales-$n --env-file .env -f src/docker-compose.yml -f src/deploy/docker-compose.vps.yml" && $C build --build-arg SOURCE_COMMIT=$(git -C src rev-parse HEAD) app && $C up -d); done
```

## Del día a día

Cambia `principal` por el `--nombre` de la instancia.

```bash
sudo docker ps --format "table {{.Names}}\t{{.Status}}"                # qué está corriendo
sudo docker compose -p into-sales-principal logs -f app                # registro
sudo docker compose -p into-sales-principal restart app                # reiniciar la app
sudo docker compose -p into-sales-principal exec -T postgres \
  pg_dump -U postgres vocero > respaldo-$(date +%F).sql                # respaldo de la base
```

La salud del CRM (base de datos, migraciones, archivos, WhatsApp, IA, cerebro
y central) se ve en `https://crm.cliente.com/settings/health`, como
propietario o administrador.

Guarda una copia del `.env` de cada instancia (`/opt/into-sales/<nombre>/.env`).
`ENCRYPTION_KEY` cifra los tokens de WhatsApp y de la IA: sin ella, hay que
volver a pegarlos.

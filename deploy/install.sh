#!/usr/bin/env bash
# ============================================================
# into-sales — instalador en un comando para un VPS (spec 1001)
#
#   curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh \
#     | sudo bash -s -- --client acme --domain crm.acme.com
#
# Deja el CRM del cliente corriendo con HTTPS en ese dominio. Con --update lo
# actualiza (basta con --client: el dominio y lo demás se conservan) y con
# --uninstall lo quita por completo, después de respaldar su base, sus
# archivos y su .env. Nunca pisa secretos ni datos al instalar o actualizar.
#
# Varios clientes y el servicio central de into conviven en el mismo VPS
# detrás de UN solo Caddy compartido («into-edge», en /opt/into-edge), que
# crea el primer instalador que corre, así que ningún cliente necesita
# puertos propios. Cada cliente tiene su carpeta (/opt/into-sales/<cliente>),
# su proyecto de compose (into-sales-<cliente>), su Postgres con la base
# into_sales y sus volúmenes.
#
# Ayuda: bash install.sh --help
# ============================================================
set -euo pipefail

APP=into-sales
APP_PORT=3000
REPO=https://github.com/jcarlosverase/into-sales.git

MODE=install
CLIENT=principal
DOMAIN=""
BRANCH=main
CENTRAL=""
# Solo se toca INTO_CENTRAL_URL si se pasa --central o --no-central: volver a
# correr el instalador sin ellas conserva lo que ya estaba.
CENTRAL_SET=0
EXTRA_ENV=()
ASSUME_YES=0
BACKUP=1
BASE=/opt
HTTP_PORT=80
HTTPS_PORT=443
NO_SYSTEM=0
SOURCE=""

usage() {
  cat <<'EOF'
Instala, actualiza o desinstala el CRM de un cliente (into-sales) en este
servidor, con HTTPS automático.

Uso:
  sudo bash install.sh --client acme --domain crm.acme.com [opciones]   instalar
  sudo bash install.sh --update --client acme [opciones]                actualizar
  sudo bash install.sh --uninstall --client acme                        desinstalar

  --client C      Cliente (minúsculas, números y guiones; hasta 31). Cada
                  cliente tiene su carpeta, su base y sus volúmenes en el
                  mismo VPS. Por defecto: principal.
  --domain D      Dominio del CRM; su DNS debe apuntar aquí. Obligatorio al
                  instalar; al actualizar se conserva el que ya tenía.
  --central URL   Enciende el latido al servicio central de into
                  (por ejemplo https://api.into.center). Se conserva al
                  actualizar.
  --no-central    Apaga el latido al central.
  --env K=V       Fija una variable opcional del CRM en su .env (se puede
                  repetir). Solo las que lee el docker-compose, por ejemplo
                  CHANNELS=whatsapp,instagram o AGENDA=on. K= la vacía.
  --branch B      Rama del repositorio. Por defecto: main.
  --update        Actualiza un cliente ya instalado: trae el código,
                  reconstruye y reinicia, sin reinstalar paquetes.
  --uninstall     Quita el cliente por completo: contenedores, volúmenes,
                  imagen, sitio de Caddy y carpeta. Antes respalda su base,
                  sus archivos y su .env en /opt/into-backups.
  --yes           No pide confirmación al desinstalar.
  --no-backup     Desinstala sin respaldar (los datos se pierden).
  --help          Esta ayuda.

Para probar en una máquina de desarrollo (no en producción):
  --no-system     No instala paquetes, Docker ni swap, y no pide root.
  --base DIR      Carpeta base en vez de /opt.
  --ports H:S     Puertos HTTP:HTTPS del Caddy compartido (por defecto 80:443).
  --source DIR    Copia el código de esa carpeta en vez de clonar el repositorio.

Monitoreo: si el servidor ya tiene el de into (lo instala el instalador de
into-central con --monitoring), la instancia se suma sola a Prometheus.

Repositorio privado: exporta GITHUB_TOKEN (un token de solo lectura) antes de
correrlo; no se guarda en ningún archivo.
EOF
}

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mAviso:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31mError:\033[0m %s\n' "$*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --client) CLIENT="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --central)
      [ -n "${2:-}" ] || die "--central necesita la URL (por ejemplo --central https://api.into.center); para apagarlo, --no-central"
      CENTRAL="$2"; CENTRAL_SET=1; shift 2 ;;
    --no-central) CENTRAL=""; CENTRAL_SET=1; shift ;;
    --env)
      [ -n "${2:-}" ] || die "--env necesita CLAVE=valor (por ejemplo --env AGENDA=on)"
      EXTRA_ENV+=("$2"); shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --update) MODE=update; shift ;;
    --uninstall) MODE=uninstall; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    --no-backup) BACKUP=0; shift ;;
    --base) BASE="${2:-}"; shift 2 ;;
    --ports)
      printf "%s" "${2:-}" | grep -Eq "^[0-9]{1,5}:[0-9]{1,5}\$" || die "puertos inválidos (usa --ports 80:443)"
      HTTP_PORT="${2%%:*}"
      HTTPS_PORT="${2##*:}"
      shift 2
      ;;
    --no-system) NO_SYSTEM=1; shift ;;
    --source) SOURCE="${2:-}"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) die "opción desconocida: $1 (mira --help)" ;;
  esac
done

# --- Validación (antes de tocar nada) -------------------------
printf '%s' "$CLIENT" | grep -Eq '^[a-z0-9][a-z0-9-]{0,30}$' ||
  die "cliente inválido: $CLIENT (minúsculas, números y guiones; hasta 31)"

# En modo prueba, con prefijo: así no choca con los contenedores de desarrollo.
PROJECT="$APP-$CLIENT"
[ "$NO_SYSTEM" = 0 ] || PROJECT="prueba-$PROJECT"
DIR="$BASE/$APP/$CLIENT"
EDGE="$BASE/into-edge"
BACKUPS="$BASE/into-backups"
# Monitoring of every into app on this server (spec 1006), installed by the
# into-central installer with --monitoring.
MON="$BASE/into-monitoring"
ALIAS="$PROJECT-app"
# La base de cada cliente vive en su propio Postgres, así que se llama igual
# en todos (y como la del central: into_central).
DB_NAME=into_sales

if [ "$MODE" != install ] && [ ! -f "$DIR/.env" ]; then
  instalados=$(ls "$BASE/$APP" 2>/dev/null | tr '\n' ' ' || true)
  die "el cliente $CLIENT no está instalado en $DIR (instalados: ${instalados:-ninguno})"
fi

# Variables extra: forma CLAVE=valor; las que maneja el instalador no se
# pueden fijar así, para no romper la instancia.
for kv in ${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"}; do
  key="${kv%%=*}"
  [ "$key" != "$kv" ] && printf '%s' "$key" | grep -Eq '^[A-Z][A-Z0-9_]*$' ||
    die "--env espera CLAVE=valor en mayúsculas: $kv"
  case "$key" in
    POSTGRES_PASSWORD | BETTER_AUTH_SECRET | ENCRYPTION_KEY | META_WEBHOOK_VERIFY_TOKEN | APP_BASE_URL | DOMAIN | EDGE_ALIAS | APP_IMAGE | DATABASE_URL | METRICS_TOKEN)
      die "$key la maneja el instalador; no se fija con --env" ;;
    INTO_CENTRAL_URL) die "para el central usa --central URL o --no-central" ;;
  esac
done

if [ "$MODE" != uninstall ]; then
  # Al actualizar, el dominio sale del .env del cliente si no se pasa.
  DOMAIN=$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')
  if [ -z "$DOMAIN" ] && [ -f "$DIR/.env" ]; then
    DOMAIN=$(grep '^DOMAIN=' "$DIR/.env" | cut -d= -f2- || true)
  fi
  [ -n "$DOMAIN" ] || die "falta --domain (por ejemplo: --client acme --domain crm.acme.com)"
  printf '%s' "$DOMAIN" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' ||
    die "dominio inválido: $DOMAIN"
fi
[ -z "$CENTRAL" ] || printf '%s' "$CENTRAL" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._/-]*)?$' ||
  die "URL del central inválida: $CENTRAL"
printf '%s' "$BRANCH" | grep -Eq '^[A-Za-z0-9._/-]+$' || die "rama inválida: $BRANCH"
printf '%s:%s' "$HTTP_PORT" "$HTTPS_PORT" | grep -Eq '^[0-9]{1,5}:[0-9]{1,5}$' ||
  die "puertos inválidos (usa --ports 80:443)"
[ -z "$SOURCE" ] || [ -d "$SOURCE" ] || die "no existe la carpeta de --source: $SOURCE"

URL="https://$DOMAIN"
[ "$HTTPS_PORT" = 443 ] || URL="$URL:$HTTPS_PORT"

# --- Sistema: paquetes, Docker y swap -------------------------
require_root() {
  [ "$NO_SYSTEM" = 1 ] || [ "$(id -u)" = 0 ] || die "córrelo como root (con sudo)"
}

prepare_system() {
  command -v apt-get > /dev/null || die "este instalador es para Ubuntu o Debian"
  log "Paquetes del sistema"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git openssl tzdata > /dev/null
  if ! command -v docker > /dev/null; then
    log "Instalando Docker (get.docker.com)"
    curl -fsSL https://get.docker.com | sh > /dev/null
  fi
  systemctl enable --now docker > /dev/null 2>&1 || true
  # Hora de Lima (UTC-5) para el sistema: registro, cron y lo que muestre la
  # terminal. Los contenedores siguen en UTC a propósito: la base guarda UTC y
  # la app convierte a la zona del negocio (America/Lima por defecto).
  timedatectl set-timezone America/Lima > /dev/null 2>&1 || ln -sf /usr/share/zoneinfo/America/Lima /etc/localtime
  # Next.js necesita ~2 GB para construir: en un VPS chico, sin swap, el build
  # muere sin decir por qué.
  mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
  if [ "$mem_kb" -lt 3500000 ] && [ -z "$(swapon --noheadings 2>/dev/null)" ]; then
    log "Memoria de $((mem_kb / 1024)) MB y sin swap: creo /swapfile de 2 GB"
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile > /dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  if command -v ufw > /dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    log "Firewall activo: abro 80 y 443"
    ufw allow 80/tcp > /dev/null
    ufw allow 443/tcp > /dev/null
  fi
}

# Aviso (no error) si el DNS todavía no apunta aquí: Caddy reintenta solo el
# certificado cuando el DNS llegue.
check_dns() {
  case "$DOMAIN" in *localhost) return 0 ;; esac
  public_ip=$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
  dns_ip=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}' || true)
  if [ -z "$dns_ip" ]; then
    warn "$DOMAIN todavía no resuelve. Crea el registro A hacia ${public_ip:-la IP de este servidor}; el HTTPS se activa solo cuando llegue."
  elif [ -n "$public_ip" ] && [ "$dns_ip" != "$public_ip" ]; then
    warn "$DOMAIN apunta a $dns_ip, pero este servidor es $public_ip. Sin eso no habrá certificado."
  fi
}

port_in_use() { (exec 3<> "/dev/tcp/127.0.0.1/$1") 2> /dev/null; }

# --- Caddy compartido (into-edge) -----------------------------
# Mismo bloque en el instalador de into-central: el que corra primero lo crea
# y el otro lo reusa. Cada app deja su archivo en sites/.
prepare_edge() {
  docker network inspect into_edge > /dev/null 2>&1 || docker network create into_edge > /dev/null
  if [ -z "$(docker ps -q --filter name='^into-edge-caddy$')" ]; then
    for p in "$HTTP_PORT" "$HTTPS_PORT"; do
      port_in_use "$p" && die "el puerto $p ya está en uso por otro programa (¿Coolify, nginx o el compose de la Ruta B?). Libéralo y vuelve a correr el instalador."
    done
  fi
  mkdir -p "$EDGE/sites"
  if [ ! -f "$EDGE/Caddyfile" ]; then
    cat > "$EDGE/Caddyfile" <<'EOF'
# Caddy compartido de into: un archivo por aplicación en sites/.
# Lo escriben los instaladores de into-sales e into-central.
import /etc/caddy/sites/*.caddy
EOF
  fi
  cat > "$EDGE/docker-compose.yml" <<EOF
# Caddy compartido de into (lo escriben los instaladores; no lo edites).
services:
  caddy:
    image: caddy:2-alpine
    container_name: into-edge-caddy
    restart: unless-stopped
    ports:
      - "$HTTP_PORT:80"
      - "$HTTPS_PORT:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./sites:/etc/caddy/sites:ro
      - caddy_data:/data
      - caddy_config:/config
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }
    networks: [edge]
networks:
  edge:
    external: true
    name: into_edge
volumes:
  caddy_data:
  caddy_config:
EOF
  log "Caddy compartido (into-edge)"
  docker compose -p into-edge -f "$EDGE/docker-compose.yml" up -d --quiet-pull > /dev/null
}

reload_edge() {
  docker exec into-edge-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null 2>&1 ||
    die "la configuración de Caddy no es válida; revisa $EDGE/sites"
  docker exec into-edge-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null 2>&1 ||
    die "Caddy no aceptó la configuración nueva"
}

# Sin apps, lo compartido sobra: el monitoreo (spec 1006) y el Caddy se quitan
# con su red y sus carpetas. El sitio de Grafana no cuenta como app.
remove_shared_if_unused() {
  [ -d "$EDGE/sites" ] || return 0
  if find "$EDGE/sites" -name '*.caddy' ! -name '*into-monitoring.caddy' | grep -q .; then
    [ -z "$(docker ps -q --filter name='^into-edge-caddy$')" ] || reload_edge
    return 0
  fi
  if [ -f "$MON/docker-compose.yml" ]; then
    log "No quedan apps en este servidor: quito el monitoreo (into-monitoring)"
    for p in into-monitoring prueba-into-monitoring; do
      docker compose -p "$p" -f "$MON/docker-compose.yml" down -v > /dev/null 2>&1 || true
    done
    rm -rf "$MON"
  fi
  log "No quedan apps en este servidor: quito el Caddy compartido (into-edge)"
  docker compose -p into-edge -f "$EDGE/docker-compose.yml" down -v > /dev/null 2>&1 || true
  docker network rm into_edge > /dev/null 2>&1 || true
  rm -rf "$EDGE"
}

# Un dominio solo puede ser de un sitio.
domain_free() {
  for f in "$EDGE"/sites/*.caddy; do
    [ -f "$f" ] || continue
    [ "$f" = "$EDGE/sites/$PROJECT.caddy" ] && continue
    grep -Eq "^$1(:[0-9]+)? \{" "$f" && die "$1 ya lo usa $(basename "$f" .caddy)"
  done
  return 0
}

# --- Código ---------------------------------------------------
fetch_code() {
  mkdir -p "$DIR"
  if [ -n "$SOURCE" ]; then
    log "Copiando el código de $SOURCE"
    mkdir -p "$DIR/src"
    tar -C "$SOURCE" --exclude=./node_modules --exclude=./.next --exclude=./.env -cf - . | tar -C "$DIR/src" -xf -
    COMMIT=$(git -C "$SOURCE" rev-parse HEAD 2>/dev/null || echo "")
    return 0
  fi
  auth=()
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    basic=$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')
    auth=(-c "http.extraHeader=Authorization: Basic $basic")
  fi
  if [ -d "$DIR/src/.git" ]; then
    log "Actualizando el código (rama $BRANCH)"
    git ${auth[@]+"${auth[@]}"} -C "$DIR/src" fetch -q origin "$BRANCH"
    git -C "$DIR/src" checkout -q -B "$BRANCH" "origin/$BRANCH"
  else
    log "Clonando $REPO (rama $BRANCH)"
    git ${auth[@]+"${auth[@]}"} clone -q --branch "$BRANCH" "$REPO" "$DIR/src" ||
      die "no se pudo clonar $REPO. Si es privado, exporta GITHUB_TOKEN."
  fi
  COMMIT=$(git -C "$DIR/src" rev-parse HEAD)
}

# --- .env del cliente -------------------------------------------
# Los secretos se generan UNA vez; lo demás se reescribe en cada corrida para
# que cambiar --domain o --central baste con volver a correr el instalador.
env_set() {
  if grep -q "^$1=" "$DIR/.env"; then
    tmp=$(mktemp)
    awk -v k="$1" -v v="$2" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$DIR/.env" > "$tmp"
    cat "$tmp" > "$DIR/.env"
    rm -f "$tmp"
  else
    printf '%s=%s\n' "$1" "$2" >> "$DIR/.env"
  fi
}
env_secret() { grep -q "^$1=." "$DIR/.env" || env_set "$1" "$2"; }

write_env() {
  if [ ! -f "$DIR/.env" ]; then
    (umask 077 && printf '# into-sales (%s): lo escribe deploy/install.sh. Guarda una copia de los secretos.\n' "$CLIENT" > "$DIR/.env")
  fi
  chmod 600 "$DIR/.env"
  env_secret POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  env_secret BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
  env_secret ENCRYPTION_KEY "$(openssl rand -base64 32)"
  env_secret META_WEBHOOK_VERIFY_TOKEN "$(openssl rand -hex 32)"
  env_set APP_BASE_URL "$URL"
  env_set DOMAIN "$DOMAIN"
  [ "$CENTRAL_SET" = 0 ] || env_set INTO_CENTRAL_URL "$CENTRAL"
  CENTRAL=$(grep "^INTO_CENTRAL_URL=" "$DIR/.env" | cut -d= -f2- || true)
  env_set EDGE_ALIAS "$ALIAS"
  env_set APP_IMAGE "$APP:$CLIENT"
  # Spec 1006: with the into monitoring on this server, the instance takes
  # its shared token so Prometheus can read /api/metrics.
  if [ -s "$MON/metrics-token" ]; then
    env_set METRICS_TOKEN "$(cat "$MON/metrics-token")"
  fi
  # Solo sirven las variables que el docker-compose le pasa a la app: otra
  # quedaría en el .env sin efecto, así que se rechaza.
  for kv in ${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"}; do
    key="${kv%%=*}"
    grep -q "\${${key}[:}]" "$DIR/src/docker-compose.yml" ||
      die "$key no la lee el docker-compose de into-sales, así que no tendría efecto"
    env_set "$key" "${kv#*=}"
    log "Variable $key fijada"
  done
}

# Tells Prometheus where this instance is on the into_edge network.
write_metrics_target() {
  [ -s "$MON/metrics-token" ] || return 0
  mkdir -p "$MON/targets"
  printf '[{"targets": ["%s:%s"], "labels": {"app": "%s", "instance": "%s"}}]\n' \
    "$ALIAS" "$APP_PORT" "$APP" "$PROJECT" > "$MON/targets/$PROJECT.json"
  chmod 644 "$MON/targets/$PROJECT.json"
}

dc() {
  docker compose -p "$PROJECT" --env-file "$DIR/.env" \
    -f "$DIR/src/docker-compose.yml" -f "$DIR/src/deploy/docker-compose.vps.yml" "$@"
}

wait_healthy() {
  log "Esperando a que la app esté sana (las migraciones corren al arrancar)"
  for _ in $(seq 1 90); do
    id=$(dc ps -q app)
    state=$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo "")
    [ "$state" = healthy ] && return 0
    sleep 4
  done
  dc logs --tail 40 app >&2
  die "la app no quedó sana en 6 minutos (arriba, el final de su registro)"
}

start_postgres() {
  dc up -d postgres > /dev/null 2>&1 || die "no pude arrancar el Postgres de $PROJECT"
  state=""
  for _ in $(seq 1 45); do
    state=$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q postgres)" 2>/dev/null || echo "")
    [ "$state" = healthy ] && return 0
    sleep 2
  done
  die "el Postgres de $PROJECT no arrancó"
}

# Hasta 2026-10-17 la base se llamaba «vocero». En un volumen que ya la tiene,
# la renombra una vez (con la app parada: Postgres no renombra una base con
# conexiones abiertas). En un volumen nuevo, Postgres ya la crea con el nombre
# nuevo y no hay nada que hacer.
rename_database() {
  start_postgres
  dbs=$(dc exec -T postgres psql -U postgres -d postgres -tAc 'SELECT datname FROM pg_database')
  if printf '%s\n' "$dbs" | grep -qx vocero && ! printf '%s\n' "$dbs" | grep -qx "$DB_NAME"; then
    log "Renombrando la base vocero a $DB_NAME"
    dc stop app > /dev/null 2>&1 || true
    dc exec -T postgres psql -U postgres -d postgres -qc "ALTER DATABASE vocero RENAME TO $DB_NAME"
  fi
}

wait_https() {
  for _ in $(seq 1 30); do
    curl -fsk --max-time 5 --resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" "$URL/api/health" > /dev/null 2>&1 && return 0
    sleep 3
  done
  return 1
}

# --- Desinstalación ----------------------------------------------
confirm_uninstall() {
  [ "$ASSUME_YES" = 1 ] && return 0
  [ -r /dev/tty ] || die "para desinstalar sin terminal, agrega --yes"
  printf 'Esto borra el CRM de %s con todos sus datos%s.\nEscribe el nombre del cliente para confirmar: ' \
    "$CLIENT" "$([ "$BACKUP" = 1 ] && printf ' (antes los respaldo en %s)' "$BACKUPS")" > /dev/tty
  IFS= read -r answer < /dev/tty
  [ "$answer" = "$CLIENT" ] || die "no coincide; no borré nada"
}

# Base (pg_dump), archivos subidos (/data de la app) y .env, en una carpeta
# con fecha. Si algo falla, se detiene sin borrar nada.
backup_client() {
  stamp=$(date +%Y%m%d-%H%M%S)
  dest="$BACKUPS/$PROJECT-$stamp"
  (umask 077 && mkdir -p "$dest")
  log "Respaldando en $dest"
  cp "$DIR/.env" "$dest/.env"
  start_postgres
  dc exec -T postgres pg_dump -U postgres "$DB_NAME" > "$dest/$DB_NAME.sql" ||
    die "no pude respaldar la base; no borré nada"
  volume=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" | grep '_app_data$' || true)
  if [ -n "$volume" ]; then
    # La imagen de Postgres ya está en el servidor: sirve para leer el volumen.
    docker run --rm -v "$volume:/data:ro" postgres:16-alpine tar -C /data -czf - . > "$dest/app-data.tar.gz" ||
      die "no pude respaldar los archivos; no borré nada"
  fi
  chmod -R go-rwx "$dest"
}

uninstall() {
  confirm_uninstall
  dest=""
  if [ -f "$DIR/src/docker-compose.yml" ]; then
    [ "$BACKUP" = 0 ] || backup_client
    log "Quitando los contenedores y volúmenes de $PROJECT"
    dc down -v --remove-orphans > /dev/null 2>&1 || true
  else
    warn "falta el código en $DIR/src: quito los contenedores sin respaldar la base"
    docker compose -p "$PROJECT" down -v --remove-orphans > /dev/null 2>&1 || true
  fi
  docker image rm "$APP:$CLIENT" > /dev/null 2>&1 || true
  rm -f "$EDGE/sites/$PROJECT.caddy" "$MON/targets/$PROJECT.json"
  rm -rf "$DIR"
  rmdir "$BASE/$APP" 2> /dev/null || true
  remove_shared_if_unused
  echo
  log "Listo: el CRM de $CLIENT ya no está en este servidor"
  [ -z "$dest" ] || cat <<EOF

  Respaldo:    $dest
               ($DB_NAME.sql, app-data.tar.gz y .env; guárdalo fuera del VPS)
EOF
}

# --- Instalación y actualización ---------------------------------
main() {
  require_root
  if [ "$MODE" = uninstall ]; then
    command -v docker > /dev/null || die "falta Docker"
    uninstall
    return 0
  fi
  [ "$NO_SYSTEM" = 1 ] || [ "$MODE" = update ] || prepare_system
  command -v docker > /dev/null || die "falta Docker"
  [ "$NO_SYSTEM" = 1 ] || check_dns
  prepare_edge
  domain_free "$DOMAIN"
  fetch_code
  [ -f "$DIR/src/deploy/docker-compose.vps.yml" ] ||
    die "la rama $BRANCH no trae deploy/docker-compose.vps.yml; usa una rama con el instalador"
  write_env

  log "Construyendo la imagen (la primera vez tarda varios minutos)"
  dc build --build-arg "SOURCE_COMMIT=$COMMIT" app
  rename_database
  log "Arrancando $PROJECT"
  dc up -d --remove-orphans
  wait_healthy

  cat > "$EDGE/sites/$PROJECT.caddy" <<EOF
# $PROJECT — lo escribe el instalador de into-sales.
# Spec 1006: JSON access log without the webhook token or query strings, and
# an X-Request-Id the app logs too. /api/metrics stays inside Docker.
$DOMAIN {
	log {
		format filter {
			request>uri regexp "^(/api/webhooks/[^/?]+/)[^/?]+.*\$|\\?.*\$" "\${1}[redacted]"
		}
	}
	request_header X-Request-Id {http.request.uuid}
	respond /api/metrics 404
	encode gzip
	reverse_proxy $ALIAS:$APP_PORT {
		# SSE: sin buffering en el proxy
		flush_interval -1
	}
}
EOF
  write_metrics_target
  reload_edge

  echo
  if wait_https; then
    log "Listo: $URL responde con HTTPS"
  else
    warn "la app está arriba, pero $URL todavía no responde con HTTPS. Casi siempre es el DNS: cuando apunte a este servidor, Caddy saca el certificado solo."
  fi
  cat <<EOF

  Cliente:     $CLIENT   (proyecto $PROJECT, carpeta $DIR)
  Dirección:   $URL
  Base:        $DB_NAME
  Central:     ${CENTRAL:-apagado}
EOF
  [ "$MODE" = update ] || cat <<EOF

  Siguiente:
    1. Abre $URL/register y crea la cuenta del negocio (la primera es la dueña).
    2. En Ajustes → WhatsApp conecta el número; ahí está la URL del webhook para Meta.
    3. En Ajustes → IA elige el proveedor y pega su llave.
    4. Guarda una copia de $DIR/.env (sus secretos cifran los tokens del CRM).
EOF
  cat <<EOF

  Actualizar:  install.sh --update --client $CLIENT
  Registro:    docker compose -p $PROJECT logs -f app
  Respaldo:    docker compose -p $PROJECT exec -T postgres pg_dump -U postgres $DB_NAME > $CLIENT-\$(date +%F).sql
EOF
}

main

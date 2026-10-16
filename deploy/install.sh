#!/usr/bin/env bash
# ============================================================
# into-sales — instalador en un comando para un VPS (spec 1001)
#
#   curl -fsSL https://raw.githubusercontent.com/jcarlosverase/into-sales/main/deploy/install.sh \
#     | sudo bash -s -- --dominio crm.cliente.com
#
# Deja el CRM corriendo con HTTPS en ese dominio. Volver a correr el mismo
# comando actualiza la instancia: nunca pisa sus secretos ni sus datos.
#
# Varias instancias (una por cliente) y el servicio central de into conviven
# en el mismo VPS detrás de UN solo Caddy compartido («into-edge», en
# /opt/into-edge), que crea el primer instalador que corre. Cada instancia
# tiene su carpeta, su base y su volumen: /opt/into-sales/<nombre>.
#
# Ayuda: bash install.sh --ayuda
# ============================================================
set -euo pipefail

APP=into-sales
APP_PORT=3000
REPO=https://github.com/jcarlosverase/into-sales.git

DOMINIO=""
NOMBRE=principal
RAMA=main
CENTRAL=""
# Solo se toca INTO_CENTRAL_URL si se pasa --central o --sin-central: volver a
# correr el instalador sin ellas conserva lo que ya estaba.
CENTRAL_SET=0
BASE=/opt
HTTP_PORT=80
HTTPS_PORT=443
SIN_SISTEMA=0
ORIGEN=""

usage() {
  cat <<'EOF'
Instala o actualiza into-sales en este servidor, con HTTPS automático.

Uso: sudo bash install.sh --dominio crm.cliente.com [opciones]

  --dominio D     Dominio del CRM (obligatorio). Su DNS debe apuntar aquí.
  --nombre N      Nombre de la instancia, para tener varias en el mismo VPS
                  (minúsculas, números y guiones). Por defecto: principal.
  --central URL   Enciende el latido al servicio central de into
                  (por ejemplo https://api.into.center). Al actualizar no
                  hace falta repetirlo: se conserva el que ya estaba.
  --sin-central   Apaga el latido al central.
  --rama R        Rama del repositorio. Por defecto: main.
  --ayuda         Esta ayuda.

Para probar en una máquina de desarrollo (no en producción):
  --sin-sistema   No instala paquetes, Docker ni swap, y no pide root.
  --base DIR      Carpeta base en vez de /opt.
  --puertos H:S   Puertos HTTP:HTTPS del Caddy compartido (por defecto 80:443).
  --origen DIR    Copia el código de esa carpeta en vez de clonar el repositorio.

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
    --dominio) DOMINIO="${2:-}"; shift 2 ;;
    --nombre) NOMBRE="${2:-}"; shift 2 ;;
    --central)
      [ -n "${2:-}" ] || die "--central necesita la URL (por ejemplo --central https://api.into.center); para apagarlo, --sin-central"
      CENTRAL="$2"; CENTRAL_SET=1; shift 2 ;;
    --sin-central) CENTRAL=""; CENTRAL_SET=1; shift ;;
    --rama) RAMA="${2:-}"; shift 2 ;;
    --base) BASE="${2:-}"; shift 2 ;;
    --puertos)
      printf "%s" "${2:-}" | grep -Eq "^[0-9]{1,5}:[0-9]{1,5}\$" || die "puertos inválidos (usa --puertos 80:443)"
      HTTP_PORT="${2%%:*}"
      HTTPS_PORT="${2##*:}"
      shift 2
      ;;
    --sin-sistema) SIN_SISTEMA=1; shift ;;
    --origen) ORIGEN="${2:-}"; shift 2 ;;
    -h | --ayuda | --help) usage; exit 0 ;;
    *) die "opción desconocida: $1 (mira --ayuda)" ;;
  esac
done

# --- Validación (antes de tocar nada) -------------------------
DOMINIO=$(printf '%s' "$DOMINIO" | tr '[:upper:]' '[:lower:]')
[ -n "$DOMINIO" ] || die "falta --dominio (por ejemplo: --dominio crm.cliente.com)"
printf '%s' "$DOMINIO" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' ||
  die "dominio inválido: $DOMINIO"
printf '%s' "$NOMBRE" | grep -Eq '^[a-z0-9][a-z0-9-]{0,30}$' ||
  die "nombre inválido: $NOMBRE (minúsculas, números y guiones; hasta 31)"
[ -z "$CENTRAL" ] || printf '%s' "$CENTRAL" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._/-]*)?$' ||
  die "URL del central inválida: $CENTRAL"
printf '%s' "$RAMA" | grep -Eq '^[A-Za-z0-9._/-]+$' || die "rama inválida: $RAMA"
printf '%s:%s' "$HTTP_PORT" "$HTTPS_PORT" | grep -Eq '^[0-9]{1,5}:[0-9]{1,5}$' ||
  die "puertos inválidos (usa --puertos 80:443)"
[ -z "$ORIGEN" ] || [ -d "$ORIGEN" ] || die "no existe la carpeta de --origen: $ORIGEN"

# En modo prueba, con prefijo: así no choca con los contenedores de desarrollo.
PROYECTO="$APP-$NOMBRE"
[ "$SIN_SISTEMA" = 0 ] || PROYECTO="prueba-$PROYECTO"
DIR="$BASE/$APP/$NOMBRE"
EDGE="$BASE/into-edge"
ALIAS="$PROYECTO-app"
URL="https://$DOMINIO"
[ "$HTTPS_PORT" = 443 ] || URL="$URL:$HTTPS_PORT"

# --- Sistema: paquetes, Docker y swap -------------------------
preparar_sistema() {
  [ "$(id -u)" = 0 ] || die "córrelo como root (con sudo)"
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
comprobar_dns() {
  case "$DOMINIO" in *localhost) return 0 ;; esac
  ip_publica=$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
  ip_dns=$(getent ahostsv4 "$DOMINIO" 2>/dev/null | awk 'NR==1 {print $1}' || true)
  if [ -z "$ip_dns" ]; then
    warn "$DOMINIO todavía no resuelve. Crea el registro A hacia ${ip_publica:-la IP de este servidor}; el HTTPS se activa solo cuando llegue."
  elif [ -n "$ip_publica" ] && [ "$ip_dns" != "$ip_publica" ]; then
    warn "$DOMINIO apunta a $ip_dns, pero este servidor es $ip_publica. Sin eso no habrá certificado."
  fi
}

puerto_ocupado() { (exec 3<> "/dev/tcp/127.0.0.1/$1") 2> /dev/null; }

# --- Caddy compartido (into-edge) -----------------------------
# Mismo bloque en el instalador de into-central: el que corra primero lo crea
# y el otro lo reusa. Cada app deja su archivo en sites/.
preparar_edge() {
  docker network inspect into_edge > /dev/null 2>&1 || docker network create into_edge > /dev/null
  if [ -z "$(docker ps -q --filter name='^into-edge-caddy$')" ]; then
    for p in "$HTTP_PORT" "$HTTPS_PORT"; do
      puerto_ocupado "$p" && die "el puerto $p ya está en uso por otro programa (¿Coolify, nginx o el compose de la Ruta B?). Libéralo y vuelve a correr el instalador."
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

recargar_edge() {
  docker exec into-edge-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null 2>&1 ||
    die "la configuración de Caddy no es válida; revisa $EDGE/sites"
  docker exec into-edge-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null 2>&1 ||
    die "Caddy no aceptó la configuración nueva"
}

# Un dominio solo puede ser de un sitio.
dominio_libre() {
  for f in "$EDGE"/sites/*.caddy; do
    [ -f "$f" ] || continue
    [ "$f" = "$EDGE/sites/$PROYECTO.caddy" ] && continue
    grep -Eq "^$1(:[0-9]+)? \{" "$f" && die "$1 ya lo usa $(basename "$f" .caddy)"
  done
  return 0
}

# --- Código ---------------------------------------------------
traer_codigo() {
  mkdir -p "$DIR"
  if [ -n "$ORIGEN" ]; then
    log "Copiando el código de $ORIGEN"
    mkdir -p "$DIR/src"
    tar -C "$ORIGEN" --exclude=./node_modules --exclude=./.next --exclude=./.env -cf - . | tar -C "$DIR/src" -xf -
    COMMIT=$(git -C "$ORIGEN" rev-parse HEAD 2>/dev/null || echo "")
    return 0
  fi
  auth=()
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    basic=$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')
    auth=(-c "http.extraHeader=Authorization: Basic $basic")
  fi
  if [ -d "$DIR/src/.git" ]; then
    log "Actualizando el código (rama $RAMA)"
    git ${auth[@]+"${auth[@]}"} -C "$DIR/src" fetch -q origin "$RAMA"
    git -C "$DIR/src" checkout -q -B "$RAMA" "origin/$RAMA"
  else
    log "Clonando $REPO (rama $RAMA)"
    git ${auth[@]+"${auth[@]}"} clone -q --branch "$RAMA" "$REPO" "$DIR/src" ||
      die "no se pudo clonar $REPO. Si es privado, exporta GITHUB_TOKEN."
  fi
  COMMIT=$(git -C "$DIR/src" rev-parse HEAD)
}

# --- .env de la instancia --------------------------------------
# Los secretos se generan UNA vez; lo demás se reescribe en cada corrida para
# que cambiar --dominio o --central baste con volver a correr el instalador.
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

escribir_env() {
  if [ ! -f "$DIR/.env" ]; then
    (umask 077 && printf '# into-sales (%s): lo escribe deploy/install.sh. Guarda una copia de los secretos.\n' "$NOMBRE" > "$DIR/.env")
  fi
  chmod 600 "$DIR/.env"
  env_secret POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  env_secret BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
  env_secret ENCRYPTION_KEY "$(openssl rand -base64 32)"
  env_secret META_WEBHOOK_VERIFY_TOKEN "$(openssl rand -hex 32)"
  env_set APP_BASE_URL "$URL"
  env_set DOMAIN "$DOMINIO"
  [ "$CENTRAL_SET" = 0 ] || env_set INTO_CENTRAL_URL "$CENTRAL"
  CENTRAL=$(grep "^INTO_CENTRAL_URL=" "$DIR/.env" | cut -d= -f2- || true)
  env_set EDGE_ALIAS "$ALIAS"
  env_set APP_IMAGE "$APP:$NOMBRE"
}

dc() {
  docker compose -p "$PROYECTO" --env-file "$DIR/.env" \
    -f "$DIR/src/docker-compose.yml" -f "$DIR/src/deploy/docker-compose.vps.yml" "$@"
}

esperar_salud() {
  log "Esperando a que la app esté sana (las migraciones corren al arrancar)"
  for _ in $(seq 1 90); do
    id=$(dc ps -q app)
    estado=$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo "")
    [ "$estado" = healthy ] && return 0
    sleep 4
  done
  dc logs --tail 40 app >&2
  die "la app no quedó sana en 6 minutos (arriba, el final de su registro)"
}

esperar_https() {
  for _ in $(seq 1 30); do
    curl -fsk --max-time 5 --resolve "$DOMINIO:$HTTPS_PORT:127.0.0.1" "$URL/api/health" > /dev/null 2>&1 && return 0
    sleep 3
  done
  return 1
}

# --- Instalación ------------------------------------------------
main() {
  [ "$SIN_SISTEMA" = 1 ] || preparar_sistema
  command -v docker > /dev/null || die "falta Docker"
  [ "$SIN_SISTEMA" = 1 ] || comprobar_dns
  preparar_edge
  dominio_libre "$DOMINIO"
  traer_codigo
  [ -f "$DIR/src/deploy/docker-compose.vps.yml" ] ||
    die "la rama $RAMA no trae deploy/docker-compose.vps.yml; usa una rama con el instalador"
  escribir_env

  log "Construyendo la imagen (la primera vez tarda varios minutos)"
  dc build --build-arg "SOURCE_COMMIT=$COMMIT" app
  log "Arrancando $PROYECTO"
  dc up -d --remove-orphans
  esperar_salud

  cat > "$EDGE/sites/$PROYECTO.caddy" <<EOF
# $PROYECTO — lo escribe el instalador de into-sales.
$DOMINIO {
	encode gzip
	reverse_proxy $ALIAS:$APP_PORT {
		# SSE: sin buffering en el proxy
		flush_interval -1
	}
}
EOF
  recargar_edge

  echo
  if esperar_https; then
    log "Listo: $URL responde con HTTPS"
  else
    warn "la app está arriba, pero $URL todavía no responde con HTTPS. Casi siempre es el DNS: cuando apunte a este servidor, Caddy saca el certificado solo."
  fi
  cat <<EOF

  Instancia:   $PROYECTO   (carpeta $DIR)
  Dirección:   $URL
  Central:     ${CENTRAL:-apagado}

  Siguiente:
    1. Abre $URL/register y crea la cuenta del negocio (la primera es la dueña).
    2. En Ajustes → WhatsApp conecta el número; ahí está la URL del webhook para Meta.
    3. Guarda una copia de $DIR/.env (sus secretos cifran los tokens del CRM).

  Actualizar:  vuelve a correr este mismo comando.
  Registro:    docker compose -p $PROYECTO logs -f app
EOF
}

main

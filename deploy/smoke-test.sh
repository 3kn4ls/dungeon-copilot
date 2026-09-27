#!/usr/bin/env bash
# Prueba de humo de la imagen, la misma que pasa la CI: la arranca con PGlite y con PostgreSQL
# (este, con las restricciones de deploy/k3s), comprueba que sirve la web, crea una cuenta, la
# apaga como lo hace k3s y, al volver a arrancar, la cuenta tiene que seguir ahí.
#
#   deploy/smoke-test.sh dungeon-copilot:prueba
set -euo pipefail

image=${1:?Uso: deploy/smoke-test.sh <imagen>}
run=dc-humo-$$
# Con caracteres raros a propósito: la contraseña no va dentro de DATABASE_URL.
db_password='cl@ve:con/raros#1'
account='{"username":"humo","displayName":"Humo","password":"una-clave-larga"}'
credentials='{"username":"humo","password":"una-clave-larga"}'

cleanup() {
  docker rm -f "$run-pglite" "$run-app" "$run-postgres" >/dev/null 2>&1 || true
  docker volume rm "$run-data" >/dev/null 2>&1 || true
  docker network rm "$run" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "✗ $1" >&2
  if [ -n "${2:-}" ]; then docker logs "$2" 2>&1 | tail -30 >&2; fi
  exit 1
}

# Dirección en esta máquina del puerto 3000 del contenedor.
address() { echo "http://$(docker port "$1" 3000/tcp | head -1)"; }

wait_healthy() {
  local url
  url=$(address "$1")
  for _ in $(seq 60); do
    if curl -sf "$url/api/health" >/dev/null; then return 0; fi
    sleep 1
  done
  fail "$1 no arranca" "$1"
}

post() {
  local name=$1 expected=$2 path=$3 body=$4 got
  got=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$(address "$name")$path" \
    -H 'content-type: application/json' -d "$body")
  [ "$got" = "$expected" ] || fail "$name: POST $path respondió $got en vez de $expected" "$name"
}

serves_web() {
  local name=$1 page
  for path in / /campaigns/cualquiera; do
    page=$(curl -sf "$(address "$name")$path") || fail "$name: GET $path falla" "$name"
    [[ $page == *'<div id="root">'* ]] || fail "$name: GET $path no devuelve la web" "$name"
  done
}

# Se para con SIGTERM, como en k3s; tiene que salir bien y conservar la cuenta al volver.
restart_keeps_data() {
  local name=$1
  docker stop -t 20 "$name" >/dev/null
  [ "$(docker inspect -f '{{.State.ExitCode}}' "$name")" = 0 ] || fail "$name no se apaga bien" "$name"
  docker start "$name" >/dev/null
  wait_healthy "$name"
  post "$name" 200 /api/auth/login "$credentials"
}

docker network create "$run" >/dev/null

echo "▸ Con PGlite y los datos en un volumen"
docker run -d --name "$run-pglite" -p 127.0.0.1::3000 -v "$run-data:/data" "$image" >/dev/null
wait_healthy "$run-pglite"
serves_web "$run-pglite"
post "$run-pglite" 201 /api/auth/register "$account"
restart_keeps_data "$run-pglite"

echo "▸ Con PostgreSQL, como en deploy/k3s"
docker run -d --name "$run-postgres" --network "$run" --user 999:999 --cap-drop ALL \
  --security-opt no-new-privileges -e POSTGRES_USER=dungeon -e POSTGRES_DB=dungeon \
  -e POSTGRES_PASSWORD="$db_password" -e PGDATA=/var/lib/postgresql/data/pgdata \
  postgres:16 >/dev/null
docker run --rm --network "$run" --user 1000:1000 --read-only --cap-drop ALL postgres:16 \
  timeout 60 sh -c "until pg_isready -q -h $run-postgres -U dungeon -d dungeon; do sleep 1; done" ||
  fail "PostgreSQL no arranca" "$run-postgres"
docker run -d --name "$run-app" --network "$run" -p 127.0.0.1::3000 --read-only --cap-drop ALL \
  --security-opt no-new-privileges -e DATABASE_URL="postgres://dungeon@$run-postgres:5432/dungeon" \
  -e PGPASSWORD="$db_password" "$image" >/dev/null
wait_healthy "$run-app"
serves_web "$run-app"
post "$run-app" 201 /api/auth/register "$account"
restart_keeps_data "$run-app"

echo "✓ La imagen funciona"

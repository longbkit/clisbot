#!/bin/sh
set -eu

image="${CLISBOT_DOCKER_IMAGE:-clisbot:hub-smoke}"
container="clisbot-hub-phase-zero-smoke-$$"
database="clisbot-hub-phase-zero-postgres-$$"
network="clisbot-hub-phase-zero-smoke-$$"

cleanup() {
  docker stop "$container" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"
if [ -z "${CLISBOT_DOCKER_IMAGE:-}" ]; then
  docker build --file "$repo_root/docker/base/Dockerfile" --tag "$image" "$repo_root"
fi
docker run --rm --entrypoint node "$image" /usr/local/lib/clisbot-hub-smoke.mjs
docker network create "$network" >/dev/null
docker run --detach --rm --name "$database" --network "$network" \
  --env POSTGRES_PASSWORD=postgres \
  --env POSTGRES_DB=clisbot_hub \
  postgres:17-alpine >/dev/null

attempt=0
until docker exec "$database" pg_isready --username postgres --dbname clisbot_hub >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker logs "$database"
    exit 1
  fi
  sleep 1
done

docker run --detach --rm --name "$container" --network "$network" \
  --env CLISBOT_RUN_MODE=hub \
  --env "CLISBOT_HUB_CREDENTIAL_MASTER_KEY=$(openssl rand -base64 32)" \
  --env "DATABASE_URL=postgres://postgres:postgres@$database:5432/clisbot_hub" \
  --publish 127.0.0.1::6870 \
  "$image" >/dev/null

port="$(docker port "$container" 6870/tcp | sed 's/.*://')"
attempt=0
until curl --fail --silent "http://127.0.0.1:$port/health" | grep --quiet '"ok":true'; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker logs "$container"
    exit 1
  fi
  sleep 1
done

#!/bin/sh
set -eu

image="paseo-hub-phase-zero-smoke"
container="paseo-hub-phase-zero-smoke-$$"
database="paseo-hub-phase-zero-postgres-$$"
network="paseo-hub-phase-zero-smoke-$$"

cleanup() {
  docker stop "$container" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

docker build --tag "$image" .
docker network create "$network" >/dev/null
docker run --detach --rm --name "$database" --network "$network" \
  --env POSTGRES_PASSWORD=postgres \
  --env POSTGRES_DB=paseo_hub \
  postgres:17-alpine >/dev/null

attempt=0
until docker exec "$database" pg_isready --username postgres --dbname paseo_hub >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker logs "$database"
    exit 1
  fi
  sleep 1
done

docker run --detach --rm --name "$container" --network "$network" \
  --env "DATABASE_URL=postgres://postgres:postgres@$database:5432/paseo_hub" \
  --publish 127.0.0.1::3000 \
  "$image" >/dev/null

port="$(docker port "$container" 3000/tcp | sed 's/.*://')"
attempt=0
until curl --fail --silent "http://127.0.0.1:$port/health" | grep --quiet '"ok":true'; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker logs "$container"
    exit 1
  fi
  sleep 1
done

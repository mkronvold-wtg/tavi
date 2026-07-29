#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

readonly default_interval_minutes=30
readonly no_updates_exit_code=10
readonly lock_file=".autoupdate.lock"
readonly ghcr_services=(api web worker)
readonly manifest_accept_header='application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json'
readonly docker_config_path="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
readonly env_file="compose-prod.env"
readonly images_file="compose-prod.images.env"
readonly compose_file="compose-prod.yaml"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  printf '[%s] %s\n' "$(timestamp)" "$*"
}

log_error() {
  printf '[%s] %s\n' "$(timestamp)" "$*" >&2
}

usage() {
  local now=""
  now="$(timestamp)"
  printf '[%s] Usage: %s [interval-minutes]\n[%s]        %s --once\n' "$now" "$0" "$now" "$0" >&2
}

if ! command -v docker >/dev/null 2>&1; then
  log_error 'docker is required to monitor and update the deployment stack.'
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  log_error 'curl is required to query GHCR for image metadata.'
  exit 1
fi

if ! command -v flock >/dev/null 2>&1; then
  log_error 'flock is required to serialize update cycles.'
  exit 1
fi

one_shot=false
interval_minutes="$default_interval_minutes"

if (( $# > 1 )); then
  usage
  exit 1
fi

case "${1:-}" in
  '')
    ;;
  --once)
    one_shot=true
    ;;
  *)
    interval_minutes="$1"
    if ! [[ "$interval_minutes" =~ ^[0-9]+$ ]] || (( interval_minutes <= 0 )); then
      log_error 'Interval must be a positive number of minutes.'
      exit 1
    fi
    ;;
esac

readonly interval_minutes
readonly sleep_seconds=$(( interval_minutes * 60 ))

compose_cmd() {
  local -a compose_args=()

  if [[ -f "$images_file" ]]; then
    compose_args+=(--env-file "$images_file")
  fi

  if [[ -f "$env_file" ]]; then
    compose_args+=(--env-file "$env_file")
  fi

  compose_args+=(-f "$compose_file")
  docker compose "${compose_args[@]}" "$@"
}

service_image() {
  local service="$1"
  compose_cmd config "$service" | awk -F': ' '/^[[:space:]]*image:[[:space:]]*/ { print $2; exit }'
}

image_repository() {
  local image="$1"
  local repository="${image#ghcr.io/}"

  repository="${repository%@*}"
  if [[ "$repository" == *:* ]]; then
    repository="${repository%:*}"
  fi

  printf '%s\n' "$repository"
}

image_tag() {
  local image="$1"
  local name_with_tag="${image#ghcr.io/}"

  name_with_tag="${name_with_tag%@*}"
  if [[ "$name_with_tag" == *:* ]]; then
    printf '%s\n' "${name_with_tag##*:}"
    return 0
  fi

  printf 'latest\n'
}

image_digest() {
  local image="$1"

  if [[ "$image" != *@* ]]; then
    return 1
  fi

  printf '%s\n' "${image#*@}"
}

local_image_digest() {
  local image="$1"
  local repository="$2"

  docker image inspect "$image" --format '{{range .RepoDigests}}{{println .}}{{end}}' 2>/dev/null |
    awk -v repository="ghcr.io/${repository}@" 'index($0, repository) == 1 { sub(/^.*@/, "", $0); print; exit }'
}

running_service_image_id() {
  local service="$1"
  local cid=""

  cid="$(compose_cmd ps -q "$service" 2>/dev/null || true)"
  if [[ -z "$cid" ]]; then
    return 1
  fi

  docker inspect --format '{{.Image}}' "$cid" 2>/dev/null
}

local_image_id() {
  local image="$1"
  docker image inspect "$image" --format '{{.Id}}' 2>/dev/null
}

response_status() {
  awk 'toupper($1) ~ /^HTTP\// { status=$2 } END { gsub(/\r/, "", status); print status }'
}

header_value() {
  local name="$1"

  awk -v name="$name" '
    BEGIN { IGNORECASE = 1 }
    {
      line = $0
      sub(/\r$/, "", line)
      if (line ~ "^" name ":") {
        value = substr(line, index(line, ":") + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        found = value
      }
    }
    END { print found }
  '
}

ghcr_credentials() {
  local auth_entry=""

  if [[ -n "${GHCR_USERNAME:-}" && -n "${GHCR_TOKEN:-}" ]]; then
    printf '%s:%s\n' "$GHCR_USERNAME" "$GHCR_TOKEN"
    return 0
  fi

  if [[ ! -f "$docker_config_path" ]]; then
    return 1
  fi

  auth_entry="$(tr -d '\n' < "$docker_config_path" | sed -n 's/.*"ghcr\.io"[[:space:]]*:[[:space:]]*{[^}]*"auth"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [[ -z "$auth_entry" ]]; then
    return 1
  fi

  printf '%s' "$auth_entry" | base64 --decode 2>/dev/null || return 1
}

manifest_headers() {
  local manifest_url="$1"
  local bearer_token="${2:-}"
  local -a curl_args=(-sSIL -D - -o /dev/null -H "Accept: ${manifest_accept_header}")

  if [[ -n "$bearer_token" ]]; then
    curl_args+=(-H "Authorization: Bearer ${bearer_token}")
  fi

  curl "${curl_args[@]}" "$manifest_url" 2>/dev/null
}

fetch_registry_token() {
  local authenticate_header="$1"
  local realm=""
  local service=""
  local scope=""
  local credentials=""
  local response=""
  local token=""

  realm="$(printf '%s' "$authenticate_header" | sed -n 's/^[Bb]earer[[:space:]]\+.*realm="\([^"]*\)".*/\1/p')"
  service="$(printf '%s' "$authenticate_header" | sed -n 's/.*service="\([^"]*\)".*/\1/p')"
  scope="$(printf '%s' "$authenticate_header" | sed -n 's/.*scope="\([^"]*\)".*/\1/p')"

  if [[ -z "$realm" || -z "$service" || -z "$scope" ]]; then
    return 1
  fi

  credentials="$(ghcr_credentials || true)"
  if [[ -n "$credentials" ]]; then
    response="$(curl -sSL -u "$credentials" -G --data-urlencode "service=${service}" --data-urlencode "scope=${scope}" "$realm" 2>/dev/null)"
  else
    response="$(curl -sSL -G --data-urlencode "service=${service}" --data-urlencode "scope=${scope}" "$realm" 2>/dev/null)"
  fi

  token="$(printf '%s' "$response" | tr -d '\n' | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [[ -z "$token" ]]; then
    token="$(printf '%s' "$response" | tr -d '\n' | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  fi

  if [[ -z "$token" ]]; then
    return 1
  fi

  printf '%s\n' "$token"
}

remote_image_digest() {
  local image="$1"
  local pinned_digest=""
  local repository=""
  local tag=""
  local manifest_url=""
  local headers=""
  local status=""
  local authenticate_header=""
  local bearer_token=""
  local digest=""

  pinned_digest="$(image_digest "$image" || true)"
  if [[ -n "$pinned_digest" ]]; then
    printf '%s\n' "$pinned_digest"
    return 0
  fi

  repository="$(image_repository "$image")"
  tag="$(image_tag "$image")"
  manifest_url="https://ghcr.io/v2/${repository}/manifests/${tag}"
  headers="$(manifest_headers "$manifest_url")"
  status="$(printf '%s\n' "$headers" | response_status)"

  if [[ "$status" == "401" ]]; then
    authenticate_header="$(printf '%s\n' "$headers" | header_value 'WWW-Authenticate')"
    bearer_token="$(fetch_registry_token "$authenticate_header" || true)"
    if [[ -z "$bearer_token" ]]; then
      return 1
    fi

    headers="$(manifest_headers "$manifest_url" "$bearer_token")"
    status="$(printf '%s\n' "$headers" | response_status)"
  fi

  if [[ "$status" != "200" ]]; then
    return 1
  fi

  digest="$(printf '%s\n' "$headers" | header_value 'Docker-Content-Digest')"
  if [[ -z "$digest" ]]; then
    return 1
  fi

  printf '%s\n' "$digest"
}

check_for_updates() {
  local service=""
  local image=""
  local updated_services=()
  local repository=""
  local local_digest=""
  local remote_digest=""

  log 'Checking GHCR manifest digests for updated images...'

  for service in "${ghcr_services[@]}"; do
    image="$(service_image "$service")"
    if [[ -z "$image" ]]; then
      log "Could not resolve an image for compose service '${service}'."
      return 1
    fi
    if [[ "$image" != ghcr.io/* ]]; then
      log "Compose service '${service}' is not using a GHCR image: ${image}"
      return 1
    fi

    repository="$(image_repository "$image")"
    local_digest="$(local_image_digest "$image" "$repository" || true)"
    local_id="$(local_image_id "$image" || true)"
    running_id="$(running_service_image_id "$service" || true)"
    remote_digest="$(remote_image_digest "$image" || true)"

    if [[ -z "$remote_digest" ]]; then
      log "Failed to resolve the remote manifest digest for '${service}' (${image})."
      if [[ -z "${GHCR_TOKEN:-}" && ! -f "$docker_config_path" ]]; then
        log 'Set GHCR_USERNAME and GHCR_TOKEN if the package is private, or docker login ghcr.io.'
      fi
      return 1
    fi

    # Case 1: local tag missing or not at remote digest -> pull + recreate.
    if [[ -z "$local_digest" || "$local_digest" != "$remote_digest" ]]; then
      log "Registry/tag drift for '${service}': local_tag=${local_digest:-none} remote=${remote_digest}"
      updated_services+=("$service")
      continue
    fi

    # Case 2: tag already matches remote, but running container is still on an
    # older image id (common after a manual docker pull without recreate).
    if [[ -z "$running_id" || -z "$local_id" || "$running_id" != "$local_id" ]]; then
      log "Running container drift for '${service}': running=${running_id:-none} desired=${local_id:-none}"
      updated_services+=("$service")
      continue
    fi

    log "Unchanged '${service}' @ ${remote_digest}"
  done

  if (( ${#updated_services[@]} == 0 )); then
    log 'No new GHCR images found.'
    return "$no_updates_exit_code"
  fi

  log "New images detected for: ${updated_services[*]}"
  pull_updates "${updated_services[@]}"
  return 0
}

pull_updates() {
  local services=("$@")

  if (( ${#services[@]} == 0 )); then
    return 0
  fi

  log "Pulling updated images for: ${services[*]}"
  compose_cmd pull "${services[@]}"

  # migrate shares the API image; keep it current when api changes.
  for service in "${services[@]}"; do
    if [[ "$service" == "api" ]]; then
      log 'Pulling migrate service image because api changed.'
      compose_cmd pull migrate || true
      break
    fi
  done
}

report_running_revisions() {
  local service=""
  local cid=""
  local image=""
  local revision=""
  local digest=""

  log 'Deployed service revisions:'
  for service in "${ghcr_services[@]}"; do
    cid="$(compose_cmd ps -q "$service" 2>/dev/null || true)"
    if [[ -z "$cid" ]]; then
      log "  ${service}: not running"
      continue
    fi

    image="$(docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null || true)"
    revision="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$cid" 2>/dev/null || true)"
    digest="$(docker inspect --format '{{index .RepoDigests 0}}' "$cid" 2>/dev/null || true)"
    log "  ${service}: image=${image:-unknown} revision=${revision:-unknown} digest=${digest:-unknown}"
  done
}

verify_health() {
  local service=""
  local cid=""
  local status=""
  local healthy=true
  local attempt=1
  local max_attempts=18

  log 'Verifying service health...'
  while (( attempt <= max_attempts )); do
    healthy=true
    for service in postgres api web worker; do
      cid="$(compose_cmd ps -q "$service" 2>/dev/null || true)"
      if [[ -z "$cid" ]]; then
        log "  ${service}: missing"
        healthy=false
        continue
      fi

      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
      log "  ${service}: ${status:-unknown}"
      if [[ "$status" != "healthy" && "$status" != "running" ]]; then
        healthy=false
      fi
    done

    if [[ "$healthy" == true ]]; then
      return 0
    fi

    if (( attempt == max_attempts )); then
      break
    fi

    log "Health not ready yet (attempt ${attempt}/${max_attempts}); waiting 5s..."
    sleep 5
    (( attempt += 1 ))
  done

  log_error 'One or more services failed health verification.'
  return 1
}

restart_stack() {
  log 'Stopping deployment stack...'
  compose_cmd down

  log 'Restarting deployment stack through up.sh so migrations stay aligned with manual startup.'
  if ! bash ./up.sh; then
    log_error 'up.sh failed while applying the update.'
    return 1
  fi

  if ! verify_health; then
    return 1
  fi

  report_running_revisions
}

ensure_stack_running() {
  local -a expected_services=()
  local -a running_services=()
  local -a missing_services=()
  local -A running_lookup=()
  local service=""

  mapfile -t expected_services < <(compose_cmd config --services)
  mapfile -t running_services < <(compose_cmd ps --services --filter status=running)

  for service in "${running_services[@]}"; do
    [[ -n "$service" ]] || continue
    running_lookup["$service"]=1
  done

  for service in "${expected_services[@]}"; do
    [[ -n "$service" ]] || continue
    # one-shot migrate is not expected to stay running
    if [[ "$service" == "migrate" ]]; then
      continue
    fi
    if [[ -z "${running_lookup[$service]:-}" ]]; then
      missing_services+=("$service")
    fi
  done

  if (( ${#missing_services[@]} == 0 )); then
    log 'Deployment stack is already running.'
    return 0
  fi

  log "Starting deployment stack before monitoring because these services are not running: ${missing_services[*]}"
  bash ./up.sh
  sleep 5
  verify_health || true
}

wait_for_next_check() {
  local remaining_seconds="$sleep_seconds"
  local key=""

  if [[ ! -t 0 ]]; then
    sleep "$remaining_seconds"
    return 1
  fi

  while (( remaining_seconds > 0 )); do
    if IFS= read -r -s -n 1 -t 1 key; then
      if [[ "$key" == "r" || "$key" == "R" ]]; then
        log 'Manual refresh requested. Checking for updates now.'
        return 0
      fi
    fi

    (( remaining_seconds -= 1 ))
  done

  return 1
}

run_cycle() {
  local status=0

  ensure_stack_running

  # Capture status explicitly. `if cmd; then ...; fi` resets $? to 0.
  set +e
  check_for_updates
  status=$?
  set -e

  if (( status == 0 )); then
    restart_stack
    return 0
  fi

  if (( status == no_updates_exit_code )); then
    return "$no_updates_exit_code"
  fi

  return "$status"
}

exec 9>"$lock_file"
if ! flock -n 9; then
  log_error "Another autoupdate cycle holds ${lock_file}; exiting."
  exit 1
fi

if [[ "$one_shot" == true ]]; then
  log 'Running a single GHCR update check.'
  set +e
  run_cycle
  status=$?
  set -e
  if (( status == 0 || status == no_updates_exit_code )); then
    exit 0
  fi
  exit "$status"
fi

log "Watching GHCR deployment images every ${interval_minutes} minute(s). Press r to refresh immediately."

while true; do
  set +e
  run_cycle
  status=$?
  set -e
  if (( status != 0 && status != no_updates_exit_code )); then
    log 'Update check failed. Will retry on the next interval.'
  fi

  if [[ -t 0 ]]; then
    log "Waiting ${interval_minutes} minute(s) before the next check. Press r to refresh now."
  else
    log "Sleeping for ${interval_minutes} minute(s)..."
  fi
  if wait_for_next_check; then
    continue
  fi
done

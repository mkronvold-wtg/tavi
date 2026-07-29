#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

readonly env_example_file="compose-prod.env.example"
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

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    log_error 'docker is required to stop the deployment stack.'
    exit 1
  fi
}

ensure_env_file() {
  if [[ -f "$env_file" ]]; then
    return
  fi

  if [[ ! -f "$env_example_file" ]]; then
    log_error "Missing ${env_file}."
    exit 1
  fi

  cp -- "$env_example_file" "$env_file"
  log "Created ${env_file} from ${env_example_file}."
}

compose_cmd() {
  local -a compose_args=()

  if [[ -f "$images_file" ]]; then
    compose_args+=(--env-file "$images_file")
  fi

  compose_args+=(--env-file "$env_file" -f "$compose_file")
  docker compose "${compose_args[@]}" "$@"
}

require_docker
ensure_env_file

log 'Stopping deployment stack...'
compose_cmd down "$@"

log 'Containers down'
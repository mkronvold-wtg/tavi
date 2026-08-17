#!/usr/bin/env bash
# Sync BSI pin JSON into Kubernetes consumers without Node.
# Requires: bash, jq, awk.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
images_dir="${repository_root}/infra/images"
changed_files=()

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

shopt -s nullglob
pin_files=("${images_dir}"/bsi-*.pin.json)
if [[ ${#pin_files[@]} -eq 0 ]]; then
  echo "No bsi-*.pin.json files found under ${images_dir}" >&2
  exit 1
fi

pin_files_sorted=()
while IFS= read -r line; do
  pin_files_sorted+=("${line}")
done < <(printf '%s\n' "${pin_files[@]}" | LC_ALL=C sort)

# Replace the first matching line for a YAML key.
replace_first_key_line() {
  local file="$1"
  local key_re="$2"
  local value="$3"
  local label="$4"
  local tmp
  tmp="$(mktemp)"

  awk -v key_re="${key_re}" -v value="${value}" -v label="${label}" '
    BEGIN { found=0 }
    {
      if (!found && $0 ~ key_re) {
        match($0, /^[ \t]*[^: \t]+:[ \t]*/)
        if (RSTART == 0) {
          print "Could not parse " label " line" > "/dev/stderr"
          exit 2
        }
        prefix = substr($0, RSTART, RLENGTH)
        print prefix value
        found=1
        next
      }
      print
    }
    END {
      if (!found) {
        print "Could not find " label " to rewrite for BSI pin sync" > "/dev/stderr"
        exit 1
      }
    }
  ' "${file}" > "${tmp}"
  if cmp -s "${file}" "${tmp}"; then
    rm -f "${tmp}"
  else
    # Equal if only missing final newline on the original.
    if [[ "$(cat "${tmp}")" == "$(cat "${file}")" ]]; then
      rm -f "${tmp}"
    else
      mv "${tmp}" "${file}"
    fi
  fi
}

rewrite_postgres_statefulset() {
  local file="$1"
  local image_ref="$2"
  local fs_group="$3"
  local run_as_user="$4"
  local run_as_group="$5"
  local data_mount_path="$6"
  local before after

  before="$(cat "${file}")"

  replace_first_key_line "${file}" '^[ \t]*image:[ \t]*' "${image_ref}" "image:"
  replace_first_key_line "${file}" '^[ \t]*fsGroup:[ \t]*[0-9]+[ \t]*$' "${fs_group}" "fsGroup:"
  replace_first_key_line "${file}" '^[ \t]*runAsUser:[ \t]*[0-9]+[ \t]*$' "${run_as_user}" "runAsUser:"
  replace_first_key_line "${file}" '^[ \t]*runAsGroup:[ \t]*[0-9]+[ \t]*$' "${run_as_group}" "runAsGroup:"
  replace_first_key_line "${file}" '^[ \t]*mountPath:[ \t]*' "${data_mount_path}" "mountPath:"

  after="$(cat "${file}")"
  if [[ "${before}" != "${after}" ]]; then
    local rel="${file#"${repository_root}/"}"
    rel="${rel//\\//}"
    changed_files+=("${rel}")
  fi

  if ! grep -Fq "${image_ref}" "${file}"; then
    echo "Failed to write image ref into ${file}" >&2
    exit 1
  fi
}

for pin_path in "${pin_files_sorted[@]}"; do
  for key in name source_image pull_image candidate_tag digest run_as_user run_as_group fs_group data_mount_path; do
    val="$(jq -r --arg k "${key}" '.[$k] // empty' "${pin_path}")"
    if [[ -z "${val}" || "${val}" == "null" ]]; then
      echo "${pin_path} missing required field ${key}" >&2
      exit 1
    fi
  done

  digest="$(jq -r '.digest' "${pin_path}")"
  if [[ ! "${digest}" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo "${pin_path} digest must be sha256:<64 hex>" >&2
    exit 1
  fi

  name="$(jq -r '.name' "${pin_path}")"
  pull_image="$(jq -r '.pull_image' "${pin_path}")"
  image_ref="${pull_image}@${digest}"
  fs_group="$(jq -r '.fs_group' "${pin_path}")"
  run_as_user="$(jq -r '.run_as_user' "${pin_path}")"
  run_as_group="$(jq -r '.run_as_group' "${pin_path}")"
  data_mount_path="$(jq -r '.data_mount_path' "${pin_path}")"

  consumers=()
  while IFS= read -r c; do
    [[ -n "${c}" ]] && consumers+=("${c}")
  done < <(jq -r '.consumers // [] | .[]' "${pin_path}")

  if [[ ${#consumers[@]} -eq 0 ]]; then
    echo "${name}: no consumers (${image_ref})"
    continue
  fi

  for relative_path in "${consumers[@]}"; do
    absolute_path="${repository_root}/${relative_path}"
    if [[ ! -f "${absolute_path}" ]]; then
      echo "Consumer missing: ${absolute_path}" >&2
      exit 1
    fi
    rewrite_postgres_statefulset \
      "${absolute_path}" \
      "${image_ref}" \
      "${fs_group}" \
      "${run_as_user}" \
      "${run_as_group}" \
      "${data_mount_path}"
  done

  echo "${name}: ${image_ref}"
done

if [[ ${#changed_files[@]} -eq 0 ]]; then
  echo "BSI Kubernetes pins already up to date."
else
  joined="$(printf '%s, ' "${changed_files[@]}")"
  echo "Updated ${joined%, }."
fi

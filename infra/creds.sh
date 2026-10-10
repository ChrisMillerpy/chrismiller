#!/usr/bin/env bash
# Infra credentials, kept in the macOS Keychain (service "withchris-infra"), never in a file.
#
#   ./infra/creds.sh set CLOUDFLARE_API_TOKEN   # prompts for the value (hidden) and stores it
#   ./infra/creds.sh get TF_VAR_admin_worker_password | pbcopy
#   ./infra/creds.sh list                       # which are set (names only)
#   eval "$(./infra/creds.sh env)"              # export them all into this shell, then run terraform
#   ./infra/creds.sh delete NAME

set -euo pipefail

SERVICE="${CREDS_SERVICE:-withchris-infra}"
NAMES=(
  CLOUDFLARE_API_TOKEN
  SUPABASE_ACCESS_TOKEN
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  TF_VAR_database_password
  TF_VAR_admin_worker_password
)

known() {
  local n
  for n in "${NAMES[@]}"; do [[ "$n" == "$1" ]] && return 0; done
  echo "Unknown name: $1 (expected one of: ${NAMES[*]})" >&2
  return 1
}

get() { security find-generic-password -s "$SERVICE" -a "$1" -w 2>/dev/null; }

case "${1:-}" in
  set)
    known "${2:?name}"
    # -w as the last option makes `security` prompt, so the value never appears in argv or history.
    security add-generic-password -U -s "$SERVICE" -a "$2" -w
    echo "Stored $2." >&2
    ;;
  get)
    known "${2:?name}"
    get "$2" || { echo "$2 is not set." >&2; exit 1; }
    ;;
  delete)
    known "${2:?name}"
    security delete-generic-password -s "$SERVICE" -a "$2" >/dev/null && echo "Deleted $2." >&2
    ;;
  list)
    for n in "${NAMES[@]}"; do
      if get "$n" >/dev/null; then echo "set      $n"; else echo "missing  $n"; fi
    done
    ;;
  env)
    for n in "${NAMES[@]}"; do
      if v="$(get "$n")"; then
        printf 'export %s=%q\n' "$n" "$v"
      else
        echo "warning: $n is not set (./infra/creds.sh set $n)" >&2
      fi
    done
    ;;
  *)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 2
    ;;
esac

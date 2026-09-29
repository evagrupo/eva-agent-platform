#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
env_file="$script_dir/../../.env.remotion.local"

if [[ ! -r "$env_file" ]]; then
  echo "Missing $env_file. The local Remotion credential file is required." >&2
  exit 1
fi

set -a
source "$env_file"
set +a

if [[ "$#" -eq 0 ]]; then
  echo "No command supplied." >&2
  exit 2
fi

exec "$@"

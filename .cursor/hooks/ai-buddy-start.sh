#!/usr/bin/env bash

set -u

API_BASE="${AI_BUDDY_CUBE_API_URL:-${CUBE_API_URL:-http://localhost:3000}}"
DISPLAY_NAME="${AI_BUDDY_IMAGE_NAME:-ai-buddy-sample.gif}"
BRIGHTNESS="${AI_BUDDY_BRIGHTNESS:-100}"

# Drain hook input before returning a valid hook response.
while IFS= read -r _line; do
  :
done

if command -v curl >/dev/null 2>&1; then
  curl --silent --show-error --fail --max-time 2 \
    --request POST \
    --get --data-urlencode "name=${DISPLAY_NAME}" \
    "${API_BASE}/select" >/dev/null 2>&1 || true

  curl --silent --show-error --fail --max-time 2 \
    --request POST \
    "${API_BASE}/show?brt=${BRIGHTNESS}" >/dev/null 2>&1 || true
fi

echo '{}'
exit 0

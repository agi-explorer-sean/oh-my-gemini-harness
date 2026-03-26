#!/bin/bash
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# ============================================================================
# gemini-claude: Launch Gemini CLI with Claude model via model proxy
#
# Usage:
#   bash gemini-claude.sh [gemini args...]
#   bash gemini-claude.sh                        # defaults to claude-sonnet-4-6
#   bash gemini-claude.sh --model claude-opus-4-6
#   bash gemini-claude.sh -p "explain this code"
#
# The script starts the model translation proxy, then launches gemini
# with --proxy_address pointing to it. Claude requests go directly to
# Vertex AI via ADC; non-Claude requests pass through to the Gemini API.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_PATH="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || echo "$SCRIPT_DIR/../../../..")"
PROXY_SCRIPT="$SCRIPT_DIR/__tests__/run-proxy.ts"
PROXY_OUTPUT="/tmp/model-proxy-$$.txt"

# Default model if none specified
HAS_MODEL=false
for arg in "$@"; do
  if [[ "$arg" == --model* ]]; then
    HAS_MODEL=true
    break
  fi
done

cleanup() {
  if [ -n "$PROXY_PID" ]; then
    kill "$PROXY_PID" 2>/dev/null
    wait "$PROXY_PID" 2>/dev/null
  fi
  rm -f "$PROXY_OUTPUT"
}
trap cleanup EXIT

# Start model proxy
(cd "$REPO_PATH" && bun "$PROXY_SCRIPT" > "$PROXY_OUTPUT" 2>&1) &
PROXY_PID=$!
sleep 3

PROXY_PORT=$(grep "PROXY_PORT=" "$PROXY_OUTPUT" | sed 's/PROXY_PORT=//')
if [ -z "$PROXY_PORT" ]; then
  echo "ERROR: Model proxy failed to start"
  cat "$PROXY_OUTPUT"
  exit 1
fi

# Verify healthz
if ! curl -sf "http://localhost:$PROXY_PORT/healthz" > /dev/null; then
  echo "ERROR: Proxy healthz check failed"
  exit 1
fi

echo "Model proxy ready on port $PROXY_PORT"

# Launch gemini with proxy
EXTRA_ARGS=()
if [ "$HAS_MODEL" = false ]; then
  EXTRA_ARGS+=(--model claude-sonnet-4-6)
fi

gemini \
  --proxy_address="http://localhost:$PROXY_PORT" \
  "${EXTRA_ARGS[@]}" \
  "$@"

#!/bin/bash
# Demonstrates the install command in non-interactive mode.
#
# This will write config to ~/.config/gemini/ and link the extension.
# Safe to re-run — acts as an update if already installed.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
CLI="$PROJECT_ROOT/src/cli/index.ts"
OUTPUT_DIR="$SCRIPT_DIR/output"

mkdir -p "$OUTPUT_DIR"

echo "=== oh-my-gemini install (non-interactive) ==="
echo

bun "$CLI" install --no-tui --skip-auth 2>&1 | tee "$OUTPUT_DIR/install.txt"

echo
echo "Done. Output saved to $OUTPUT_DIR/"

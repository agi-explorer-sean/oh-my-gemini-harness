#!/bin/bash
# Demonstrates the version and help commands.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
CLI="$PROJECT_ROOT/src/cli/index.ts"
OUTPUT_DIR="$SCRIPT_DIR/output"

mkdir -p "$OUTPUT_DIR"

echo "=== oh-my-gemini version ==="
echo

echo "--- --version flag ---"
bun "$CLI" --version 2>&1 | tee "$OUTPUT_DIR/version-flag.txt"
echo

echo "--- version subcommand ---"
bun "$CLI" version 2>&1 | tee "$OUTPUT_DIR/version-subcommand.txt"
echo

echo "--- --help ---"
bun "$CLI" --help 2>&1 | tee "$OUTPUT_DIR/help.txt"
echo

echo "Done. Output saved to $OUTPUT_DIR/"

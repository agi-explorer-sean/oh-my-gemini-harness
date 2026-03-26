#!/bin/bash
# Demonstrates the run command.
#
# The run command requires a running Gemini server. Without one, it will
# fail gracefully — this example captures that behavior to show the
# expected error output.
#
# To use run for real, start gemini first:
#   gemini
# Then in another terminal:
#   bun src/cli/index.ts run "Fix the bug in index.ts"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
CLI="$PROJECT_ROOT/src/cli/index.ts"
OUTPUT_DIR="$SCRIPT_DIR/output"

mkdir -p "$OUTPUT_DIR"

echo "=== oh-my-gemini run ==="
echo

echo "--- Help ---"
bun "$CLI" run --help 2>&1 | tee "$OUTPUT_DIR/help.txt"
echo

echo "--- Run with short timeout (no server — expected failure) ---"
timeout 15 bun "$CLI" run --timeout 5000 "Hello, test message" 2>&1 | tee "$OUTPUT_DIR/no-server.txt"
EXIT_CODE=$?
echo
echo "Exit code: $EXIT_CODE (non-zero expected without a running server)"

echo
echo "Done. Output saved to $OUTPUT_DIR/"

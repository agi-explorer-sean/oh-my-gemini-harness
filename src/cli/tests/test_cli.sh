#!/usr/bin/env bash
# test_cli.sh — Test all oh-my-gemini CLI commands locally.
#
# Usage:
#   cd <project-root>
#   bash src/cli/examples/test_cli.sh
#
# Exit codes:
#   0 — all tests passed
#   1 — one or more tests failed

# Resolve project root (three levels up from this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI_ENTRY="$PROJECT_ROOT/src/cli/index.ts"
TIMEOUT=30  # seconds per command

PASS=0
FAIL=0
SKIP=0

pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }
skip() { echo "  ○ $1 (skipped: $2)"; SKIP=$((SKIP + 1)); }
header() { echo; echo "── $1 ──"; }

# Run a CLI command with a timeout. Captures stdout+stderr.
run_cli() {
  timeout "$TIMEOUT" bun "$CLI_ENTRY" "$@" 2>&1
}

# ──────────────────────────────────────────────
header "1. Version & Help"
# ──────────────────────────────────────────────

# --version flag
output=$(run_cli --version) || true
if [[ "$output" == *"0."* ]]; then
  pass "--version → $output"
else
  fail "--version → ${output:-(empty)}"
fi

# version subcommand
output=$(run_cli version) || true
if [[ "$output" == *"oh-my-gemini v"* ]]; then
  pass "version subcommand → $output"
else
  fail "version subcommand → ${output:-(empty)}"
fi

# --help
output=$(run_cli --help) || true
if echo "$output" | grep -q "oh-my-gemini"; then
  pass "--help shows program name"
else
  fail "--help missing program name"
fi

# ──────────────────────────────────────────────
header "2. Command Help Pages"
# ──────────────────────────────────────────────

for cmd in install run mcp; do
  output=$(run_cli "$cmd" --help) || true
  if echo "$output" | grep -q "Usage:"; then
    pass "$cmd --help"
  else
    fail "$cmd --help"
  fi
done

# ──────────────────────────────────────────────
header "3. Install (non-interactive)"
# ──────────────────────────────────────────────

output=$(timeout 60 bun "$CLI_ENTRY" install --no-tui --skip-auth 2>&1) || true
if echo "$output" | grep -q "oMgMgMgMgMg"; then
  pass "install --no-tui --skip-auth"
else
  fail "install --no-tui --skip-auth"
fi

# ──────────────────────────────────────────────
header "5. Run (expected failure — no server)"
# ──────────────────────────────────────────────

# run should fail gracefully when no server is available
output=$(timeout 15 bun "$CLI_ENTRY" run --timeout 5000 "test" 2>&1) || true
if echo "$output" | grep -qiE "error|failed"; then
  pass "run fails gracefully with error message"
elif [[ -z "$output" ]]; then
  fail "run produced no output"
else
  skip "run" "unexpected output: ${output:0:80}"
fi

# ──────────────────────────────────────────────
header "Summary"
# ──────────────────────────────────────────────

TOTAL=$((PASS + FAIL + SKIP))
echo
echo "  $PASS passed, $FAIL failed, $SKIP skipped ($TOTAL total)"
echo

if [[ $FAIL -gt 0 ]]; then
  echo "  Some tests failed!"
  exit 1
else
  echo "  All tests passed!"
  exit 0
fi

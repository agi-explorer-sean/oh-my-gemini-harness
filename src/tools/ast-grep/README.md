# ast-grep

AST-aware code search and replacement tool.

## Differences from Vendor Core

| Feature   | Local                       | Vendor                             |
:           : (`src/tools/ast-grep`)      : (`third_party/oh-my-opencode/...`) :
| --------- | --------------------------- | ---------------------------------- |
| Cache     | `~/.cache/oh-my-gemini/bin` | `~/.cache/oh-my-opencode/bin`      |
: Directory :                             :                                    :
| Identity  | Oh-My-Gemini                | Oh-My-OpenCode                     |

## Re-imported from oh-my-opencode

-   Core logic for spawning the `sg` binary and parsing compact JSON output.
-   Language extension mappings and supported CLI/NAPI language lists.
-   Error handling for missing binaries and timeout logic.

## Modified for Gemini

-   **Path Isolation**: Redirected binary downloads and cache lookups to
    `oh-my-gemini` specific paths. This prevents state pollution and locking
    conflicts when multiple "Oh My" framework extensions are installed.
-   **Environment Branding**: Updated log messages and user hints to reflect the
    Gemini environment.

---

## Bug Investigation & Fixes (2026-02-26)

### Architecture

```
tools.ts          Tool definitions (description, args, execute)
  |
  v
cli.ts            CLI runner — spawns `sg` binary, parses output
  |                 runSg() → runSgInternal() (search/preview)
  |                         → runSgApply()    (apply changes)
  v
constants.ts      Binary resolution chain, language lists, limits
  |
  v
downloader.ts     Auto-download from GitHub releases
  |
  v
utils.ts          Output formatters (search, replace, analyze, transform)
  |
  v
types.ts          Shared type definitions (SgResult, CliMatch, etc.)
```

### Binary Resolution Chain (`constants.ts:findSgCliPathSync`)

1. Cached binary (`~/.cache/oh-my-gemini/bin/sg`)
2. npm package (`@ast-grep/cli/sg` via `createRequire`)
3. Platform-specific package (`@ast-grep/cli-linux-x64-gnu/ast-grep`)
4. Homebrew (macOS only: `/opt/homebrew/bin/sg`, `/usr/local/bin/sg`)
5. Fallback: bare `"sg"` (may conflict with util-linux `sg` on Linux)

Current environment resolves to: `node_modules/@ast-grep/cli/sg` (ast-grep 0.41.0)

### Bugs Found and Fixed

#### Bug 1: `--json=compact` and `--update-all` mutual exclusion

**File:** `cli.ts`
**Severity:** Critical — `ast_grep_replace` with `dryRun=false` silently did nothing

**Root cause:** The original `runSg()` built a single command with both
`--json=compact` (for structured output) and `--update-all` (to modify files).
ast-grep's CLI silently gives `--json` precedence — when both flags are present,
it outputs JSON match data but does NOT apply changes to disk.

**Fix:** Two-pass strategy in `runSg()`:
- Pass 1: `runSgInternal()` with `--json=compact` (no `--update-all`) to get match details
- Pass 2: `runSgApply()` with `--update-all` (no `--json`) to modify files on disk
- Parse "Applied N changes" from Pass 2 text output to confirm success

```typescript
// Before (broken): both flags in one command
args = ["run", "-p", pattern, "--lang", lang, "--json=compact"]
if (updateAll) args.push("--update-all")  // silently ignored by --json

// After (fixed): two separate passes
const preview = await runSgInternal({ ...options, updateAll: false })  // --json only
const apply   = await runSgApply(options)                              // --update-all only
```

#### Bug 2: Tool description discourages `dryRun=false`

**File:** `tools.ts`
**Severity:** High — model never applies changes

**Root cause:** `ast_grep_replace` description said "Dry-run by default" and
the `dryRun` arg was described as "Preview changes without applying (default: true)".
This discouraged the model from ever passing `dryRun=false`.

**Fix:** Changed description to actively instruct:
- "Pass dryRun=false to apply changes to files"
- dryRun arg: "Set to false to apply changes. When true (default), only preview."

#### Bug 3: Unnamed `$$$` does not expand in replacements

**File:** `tools.ts` (description fix)
**Severity:** High — variadic replacements produce literal `$$$` in output

**Root cause:** ast-grep's unnamed `$$$` meta-variable matches zero-or-more
nodes in search patterns, but does NOT expand captured content in replacement
strings. It outputs the literal text `$$$` instead.

Only **named** variadic meta-variables (`$$$ARGS`, `$$$PARAMS`, etc.) correctly
expand in both search and replacement.

```
Pattern                          Search    Replace
$MSG         (single named)     1 node    expands
$$ARGS       (double dollar)    1 node    expands (NOT variadic despite $$)
$$$          (triple unnamed)   0+ nodes  BROKEN — outputs literal "$$$"
$$$ARGS      (triple named)     0+ nodes  expands correctly
```

**Fix:** Tool description now documents:
- "For variadic args, use NAMED meta-vars: `pattern='console.log($$$ARGS)' rewrite='logger.info($$$ARGS)'`"
- "IMPORTANT: unnamed `$$$` does NOT expand in replacements — always use `$$$NAME` for replace"

#### Bug 4: `$$` confused with `$$$`

**File:** `tools.ts` (description fix)
**Severity:** Medium — model may use wrong syntax for variadic patterns

**Root cause:** `$$VAR` (double dollar) is treated as a regular single-node
meta-variable by ast-grep, NOT as variadic. Only `$$$` (triple dollar) triggers
variadic matching. The previous description didn't distinguish these.

**Fix:** Description explicitly warns:
"Do NOT use `$$` (double $) — it is NOT variadic."

#### Bug 5: Replace output lacks guidance for follow-up actions

**File:** `utils.ts`
**Severity:** Medium — model doesn't know which files were modified or that imports need adding

**Root cause:** `formatReplaceResult` showed no `[APPLIED]` prefix when changes
were applied, didn't list which files were modified, and didn't remind the model
that additional changes (like adding imports) require the edit tool.

**Fix:**
- Added `[APPLIED]` prefix (was empty string)
- Added unique file listing: `Modified files: src/app.ts, src/server.ts`
- Added follow-up reminder: "If you need to add imports or make other changes to these files, use the edit tool."

### Meta-Variable Reference

| Syntax       | Matches                  | Search | Replace | Example                           |
| ------------ | ------------------------ | ------ | ------- | --------------------------------- |
| `$NAME`      | Exactly 1 AST node       | Yes    | Yes     | `console.log($MSG)`               |
| `$$NAME`     | Exactly 1 AST node       | Yes    | Yes     | Same as `$NAME` (NOT variadic)    |
| `$$$`        | 0 or more AST nodes      | Yes    | **No**  | Search only: `console.log($$$)`   |
| `$$$NAME`    | 0 or more AST nodes      | Yes    | Yes     | `console.log($$$ARGS)`            |

### AST-Aware False Positive Avoidance

ast-grep operates on AST nodes, not text. This means:

- `console.log` inside string literals (`'Uses console.log'`) is NOT matched
  because it's a `string` node, not a `call_expression` node
- `console.log` inside template literals is NOT matched
- `console.log` inside comments is NOT matched

This was verified with a dedicated false-positive trap file (`error-handler.ts`)
containing string literals like `'console.log for backward compat'`.

### End-to-End Test Results (27/27 passing)

```
Test 1: Binary Resolution              — findSgCliPathSync, getSgCliPath
Test 2: Search ($MSG single-arg)       — 2 matches across 2 files
Test 3: Variadic Search ($$$)          — 3 matches (all console.error calls)
Test 4: $$ is NOT variadic             — 1 match (single-arg only)
Test 5: Dry Run                        — Preview without modifying files
Test 6: Apply Single-Arg Replace       — Two-pass: files modified, string literals preserved
Test 7: Named Variadic Replace ($$$ARGS) — Multi-arg calls correctly expanded
Test 8: Globs Filtering                — Exclude patterns work
Test 9: No Matches                     — Clean "No matches found" output
```

### Benchmark Results (ast-grep benchmark)

#### Run 3 (pre-fix)

| Mode   | Replacements | Imports Added | False Positives | Method          |
| ------ | ------------ | ------------- | --------------- | --------------- |
| Agent  | 37/37        | 0/8           | 0               | ast_grep_replace |
| Direct | 37/37        | 8/8           | 0               | File-by-file    |

Agent used `ast_grep_replace` for batch replacement but got stuck on background
tasks when adding imports. Direct completed via file-by-file editing.

#### Run 4 (post-fix)

| Mode   | Replacements | Imports Added | False Positives | Method       |
| ------ | ------------ | ------------- | --------------- | ------------ |
| Agent  | 37/37        | 8/8           | 0               | File-by-file |
| Direct | 37/37        | 8/8           | 0               | File-by-file |

Both modes completed 8/8 files with imports. Neither used `ast_grep_replace` —
the task (8 files) is too small for the model to prefer batch replacement over
file-by-file editing. A harder benchmark (50+ files) would better demonstrate
the ast-grep advantage. Both modes correctly preserve string-literal false
positives in `error-handler.ts`.

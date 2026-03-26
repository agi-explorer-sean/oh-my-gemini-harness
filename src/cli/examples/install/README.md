# CLI Example: Install

Runs the 9-step installer in non-interactive mode.

## How to run

```bash
# From project root
bash src/cli/examples/install/run_example.sh

# Or run directly
bun src/cli/index.ts install --no-tui --skip-auth
bun src/cli/index.ts install --no-tui              # includes auth hints
```

## What it demonstrates

The installer performs 9 sequential steps:

1. **Check Gemini** — detects the `gemini` binary and version
2. **System dependencies** — checks for `gh` (GitHub CLI) and `tmux`
3. **Install dependencies** — runs `bun install` in the project directory
4. **Build extension** — runs `bun run build` to produce `dist/`
5. **Add plugin** — registers oh-my-gemini in `~/.config/gemini/gemini.json`
6. **Auth plugins** — adds authentication plugin entries
7. **Provider config** — writes provider-specific model settings
8. **Write config** — creates `~/.config/gemini/oh-my-gemini.json`
9. **Link extension** — runs `gemini extensions link .` to register with CLI

Each step shows `[OK]`, `[!]` (warning), or `[X]` (fatal error).

## Options

- `--no-tui` — non-interactive mode (no prompts, no spinners)
- `--skip-auth` — omit the "Authenticate Your Providers" hint at the end

## Notes

- Safe to re-run — acts as an update if already installed.
- If the `gemini` binary is not found, step 9 (link) is skipped with a warning.
- The `--no-tui` flag is required when running in scripts or CI.

## Output files

- `output/install.txt` — full installer output

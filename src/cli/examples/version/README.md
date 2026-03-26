# CLI Example: Version & Help

Shows version information and available commands.

## How to run

```bash
# From project root
bash src/cli/examples/version/run_example.sh

# Or run individual commands
bun src/cli/index.ts --version
bun src/cli/index.ts version
bun src/cli/index.ts --help
```

## What it demonstrates

- `--version` flag: prints the semver version (`0.1.0`)
- `version` subcommand: prints `oh-my-gemini v0.1.0`
- `--help`: lists all available commands and options

## Output files

- `output/version-flag.txt` — raw version string
- `output/version-subcommand.txt` — branded version string
- `output/help.txt` — full help text with all commands

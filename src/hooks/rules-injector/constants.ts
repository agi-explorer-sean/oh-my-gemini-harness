import { join } from "node:path";
import { getGeminiStorageDir } from "../../shared/data-path";

export const GEMINI_STORAGE = getGeminiStorageDir();
export const RULES_INJECTOR_STORAGE = join(GEMINI_STORAGE, "rules-injector");

export const PROJECT_MARKERS = [
  ".git",
  "pyproject.toml",
  "package.json",
  "Cargo.toml",
  "go.mod",
  ".venv",
];

export const PROJECT_RULE_SUBDIRS: [string, string][] = [
  [".github", "instructions"],
  [".cursor", "rules"],
  [".claude", "rules"],
  [".sisyphus", "rules"],
];

export const PROJECT_RULE_FILES: string[] = [
  ".github/copilot-instructions.md",
];

export const GITHUB_INSTRUCTIONS_PATTERN = /\.instructions\.md$/;

export const USER_RULE_DIR = ".claude/rules";

export const RULE_EXTENSIONS = [".md", ".mdc"];

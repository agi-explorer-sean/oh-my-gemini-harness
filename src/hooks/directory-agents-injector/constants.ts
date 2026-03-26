import { join } from "node:path";
import { getGeminiStorageDir } from "../../shared/data-path";

export const GEMINI_STORAGE = getGeminiStorageDir();
export const AGENTS_INJECTOR_STORAGE = join(
  GEMINI_STORAGE,
  "directory-agents",
);
export const AGENTS_FILENAME = "AGENTS.md";

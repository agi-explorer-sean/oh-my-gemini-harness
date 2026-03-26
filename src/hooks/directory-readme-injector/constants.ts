import { join } from "node:path";
import { getGeminiStorageDir } from "../../shared/data-path";

export const GEMINI_STORAGE = getGeminiStorageDir();
export const README_INJECTOR_STORAGE = join(
  GEMINI_STORAGE,
  "directory-readme",
);
export const README_FILENAME = "README.md";

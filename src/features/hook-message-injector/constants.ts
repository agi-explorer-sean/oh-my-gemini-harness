import { join } from "node:path"
import { getGeminiStorageDir } from "../../shared/data-path"

export const GEMINI_STORAGE = getGeminiStorageDir()
export const MESSAGE_STORAGE = join(GEMINI_STORAGE, "message")
export const PART_STORAGE = join(GEMINI_STORAGE, "part")

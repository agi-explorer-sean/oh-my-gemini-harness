import { join } from "node:path"
import { getGeminiStorageDir } from "../../shared/data-path"

export const GEMINI_STORAGE = getGeminiStorageDir()
export const MESSAGE_STORAGE = join(GEMINI_STORAGE, "message")
export const PART_STORAGE = join(GEMINI_STORAGE, "part")

export const THINKING_TYPES = new Set(["thinking", "redacted_thinking", "reasoning"])
export const META_TYPES = new Set(["step-start", "step-finish"])
export const CONTENT_TYPES = new Set(["text", "tool", "tool_use", "tool_result"])

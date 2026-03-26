import { describe, expect, test, spyOn, beforeEach, afterEach, mock } from "bun:test"
import { resolveModel, resolveModelWithFallback, type ModelResolutionInput, type ExtendedModelResolutionInput } from "./model-resolver"

describe("resolveModel", () => {
  describe("priority chain", () => {
    test("returns userModel when all three are set", () => {
      const input: ModelResolutionInput = {
        userModel: "google/gemini-3-pro-preview",
        inheritedModel: "google/gemini-3-pro-preview",
        systemDefault: "google/gemini-3-pro-preview",
      }
      expect(resolveModel(input)).toBe("google/gemini-3-pro-preview")
    })

    test("returns inheritedModel when userModel is undefined", () => {
      const input: ModelResolutionInput = {
        userModel: undefined,
        inheritedModel: "google/gemini-3-pro-preview",
        systemDefault: "google/gemini-3-pro-preview",
      }
      expect(resolveModel(input)).toBe("google/gemini-3-pro-preview")
    })

    test("returns systemDefault when both userModel and inheritedModel are undefined", () => {
      const input: ModelResolutionInput = {
        userModel: undefined,
        inheritedModel: undefined,
        systemDefault: "google/gemini-3-pro-preview",
      }
      expect(resolveModel(input)).toBe("google/gemini-3-pro-preview")
    })
  })
})

describe("resolveModelWithFallback", () => {
  describe("Step 1: UI Selection", () => {
    test("returns uiSelectedModel when provided", () => {
      const input: ExtendedModelResolutionInput = {
        uiSelectedModel: "google/gemini-3-flash-preview",
        availableModels: new Set(["google/gemini-3-pro-preview"]),
        systemDefaultModel: "google/gemini-3-pro-preview",
      }
      const result = resolveModelWithFallback(input)
      expect(result!.model).toBe("google/gemini-3-flash-preview")
      expect(result!.source).toBe("override")
    })
  })

  describe("Step 2: Config Override", () => {
    test("returns userModel when provided", () => {
      const input: ExtendedModelResolutionInput = {
        userModel: "google/gemini-3-pro-preview",
        availableModels: new Set(["google/gemini-3-pro-preview"]),
        systemDefaultModel: "google/gemini-3-pro-preview",
      }
      const result = resolveModelWithFallback(input)
      expect(result!.model).toBe("google/gemini-3-pro-preview")
      expect(result!.source).toBe("override")
    })
  })

  describe("Step 3: Provider fallback chain", () => {
    test("resolves from fallback chain", () => {
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [{ providers: ["google"], model: "gemini-3-pro-preview" }],
        availableModels: new Set(["google/gemini-3-pro-preview"]),
        systemDefaultModel: "google/gemini-2.5-flash",
      }
      const result = resolveModelWithFallback(input)
      expect(result!.model).toBe("google/gemini-3-pro-preview")
      expect(result!.source).toBe("provider-fallback")
    })
  })

  describe("Step 4: System default", () => {
    test("returns system default when no match in fallback chain", () => {
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [{ providers: ["google"], model: "nonexistent" }],
        availableModels: new Set(["google/gemini-3-pro-preview"]),
        systemDefaultModel: "google/gemini-3-pro-preview",
      }
      const result = resolveModelWithFallback(input)
      expect(result!.model).toBe("google/gemini-3-pro-preview")
      expect(result!.source).toBe("system-default")
    })
  })
})

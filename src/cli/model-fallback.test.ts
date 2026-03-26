import { describe, expect, test } from "bun:test"

import { generateModelConfig } from "./model-fallback"
import type { InstallConfig } from "./types"

function createConfig(overrides: Partial<InstallConfig> = {}): InstallConfig {
  return {
    hasClaude: false,
    isMax20: false,
    hasOpenAI: false,
    hasGemini: false,
    hasCopilot: false,
    hasGeminiZen: false,
    hasZaiCodingPlan: false,
    hasKimiForCoding: false,
    ...overrides,
  }
}

describe("generateModelConfig", () => {
  describe("no providers available", () => {
    test("returns ULTIMATE_FALLBACK for all agents and categories when no providers", () => {
      // #given no providers are available
      const config = createConfig()

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then should use ULTIMATE_FALLBACK for everything
      expect(result).toMatchSnapshot()
    })
  })

  describe("single native provider", () => {
    test("uses Gemini models when only Gemini is available", () => {
      // #given only Gemini is available
      const config = createConfig({ hasGemini: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then should use Gemini models
      expect(result).toMatchSnapshot()
    })

    test("uses Gemini models with isMax20 flag", () => {
      // #given Gemini is available with Max 20 plan
      const config = createConfig({ hasGemini: true, isMax20: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then should use higher capability models for Sisyphus
      expect(result).toMatchSnapshot()
    })
  })

  describe("fallback providers", () => {
    test("uses Gemini Zen models when only Gemini Zen is available", () => {
      // #given only Gemini Zen is available
      const config = createConfig({ hasGeminiZen: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then should use GEMINI_ZEN_MODELS
      expect(result).toMatchSnapshot()
    })

    test("uses Gemini Zen models with isMax20 flag", () => {
      // #given Gemini Zen is available with Max 20 plan
      const config = createConfig({ hasGeminiZen: true, isMax20: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then should use higher capability models
      expect(result).toMatchSnapshot()
    })
  })

  describe("mixed provider scenarios", () => {
    test("uses Gemini + Gemini Zen combination", () => {
      // #given Gemini and Gemini Zen are available
      const config = createConfig({
        hasGemini: true,
        hasGeminiZen: true,
      })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then should prefer Gemini (native) over Gemini Zen
      expect(result).toMatchSnapshot()
    })

    test("uses all providers together", () => {
      // #given all providers are available
      const config = createConfig({
        hasGemini: true,
        hasGeminiZen: true,
      })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then should prefer native providers
      expect(result).toMatchSnapshot()
    })

    test("uses all providers with isMax20 flag", () => {
      // #given all providers are available with Max 20 plan
      const config = createConfig({
        hasGemini: true,
        hasGeminiZen: true,
        isMax20: true,
      })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then should use higher capability models
      expect(result).toMatchSnapshot()
    })
  })

  describe("explore agent special cases", () => {
    test("explore uses gemini-3-flash-preview when Gemini available", () => {
      // #given Gemini is available
      const config = createConfig({ hasGemini: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then explore should use gemini-3-flash-preview
      expect(result.agents?.explore?.model).toBe("google/gemini-3-flash-preview")
    })

    test("explore uses gemini-3-flash-preview when Gemini Zen available", () => {
      // #given Gemini Zen is available
      const config = createConfig({ hasGeminiZen: true })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then explore should use gemini-3-flash-preview
      expect(result.agents?.explore?.model).toBe("gemini/gemini-3-flash-preview")
    })
  })

  describe("Sisyphus agent special cases", () => {
    test("Sisyphus is created when Gemini is available", () => {
      // #given
      const config = createConfig({ hasGemini: true, isMax20: true })

      // #when
      const result = generateModelConfig(config)

      // #then
      expect(result.agents?.sisyphus?.model).toBe("google/gemini-3-pro-preview")
    })

    test("Sisyphus is created when Gemini Zen is available", () => {
      // #given
      const config = createConfig({
        hasGeminiZen: true,
        isMax20: true,
      })

      // #when
      const result = generateModelConfig(config)

      // #then
      expect(result.agents?.sisyphus?.model).toBe("gemini/gemini-3-pro-preview")
    })

    test("Sisyphus is omitted when no fallback provider is available", () => {
      // #given
      const config = createConfig({ hasClaude: true }) // Not mapped in model-fallback.ts

      // #when
      const result = generateModelConfig(config)

      // #then
      expect(result.agents?.sisyphus).toBeUndefined()
    })
  })

  describe("Hephaestus agent special cases", () => {
    test("Hephaestus is created when Gemini is available", () => {
      // #given
      const config = createConfig({ hasGemini: true })

      // #when
      const result = generateModelConfig(config)

      // #then
      expect(result.agents?.hephaestus?.model).toBe("google/gemini-3-pro-preview")
      expect(result.agents?.hephaestus?.variant).toBe("max")
    })

    test("Hephaestus is created when Gemini Zen is available", () => {
      // #given
      const config = createConfig({ hasGeminiZen: true })

      // #when
      const result = generateModelConfig(config)

      // #then
      expect(result.agents?.hephaestus?.model).toBe("gemini/gemini-3-pro-preview")
      expect(result.agents?.hephaestus?.variant).toBe("max")
    })
  })

  describe("librarian agent special cases", () => {
    test("librarian uses gemini-3-flash-preview when Gemini is available", () => {
      // #given Gemini is available
      const config = createConfig({
        hasGemini: true,
      })

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then librarian should use gemini-3-flash-preview
      expect(result.agents?.librarian?.model).toBe("google/gemini-3-flash-preview")
    })
  })

  describe("schema URL", () => {
    test("always includes correct schema URL", () => {
      // #given any config
      const config = createConfig()

      // #when generateModelConfig is called
      const result = generateModelConfig(config)

      // #then should include correct schema URL
      expect(result.$schema).toBe(
        "https://raw.githubusercontent.com/agi-explorer-sean/omg-harness/master/assets/oh-my-gemini.schema.json"
      )
    })
  })
})

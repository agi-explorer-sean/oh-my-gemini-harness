import { describe, test, expect } from "bun:test"
import { getPluginNameWithVersion, GOOGLE_PROVIDER_CONFIG, generateOmgConfig } from "./config-manager"
import type { InstallConfig } from "./types"

describe("config-manager", () => {
  test("getPluginNameWithVersion > returns current working directory", async () => {
    const result = await getPluginNameWithVersion("0.1.0")
    expect(result).toBe(process.cwd())
  })

  describe("GOOGLE_PROVIDER_CONFIG", () => {
    test("all models include full spec (limit + modalities)", () => {
      const models = (GOOGLE_PROVIDER_CONFIG as any).google.models as Record<string, any>
      
      const required = [
        "gemini-3-pro-preview",
        "gemini-3-flash-preview",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
      ]

      for (const key of required) {
        const model = models[key]
        expect(model).toBeTruthy()
        expect(model.name).toBeTruthy()
        expect(model.limit).toBeTruthy()
        expect(model.limit.context).toBeDefined()
        expect(model.modalities).toBeTruthy()
      }
    })

    test("Gemini models have variant definitions", () => {
      const models = (GOOGLE_PROVIDER_CONFIG as any).google.models as Record<string, any>

      // #when checking Gemini Pro variants
      const pro = models["gemini-3-pro-preview"]
      // #then should have low and high variants
      expect(pro.variants).toBeTruthy()
      expect(pro.variants.low).toEqual({ thinkingLevel: "low" })
      expect(pro.variants.high).toEqual({ thinkingLevel: "high" })

      // #when checking Gemini Flash variants
      const flash = models["gemini-3-flash-preview"]
      expect(flash.variants).toBeTruthy()
      expect(flash.variants.medium).toEqual({ thinkingLevel: "medium" })
    })
  })

  describe("generateOmgConfig - model fallback system", () => {
    test("generates native gemini models when Gemini available", () => {
      // #given Gemini is available
      const config: InstallConfig = {
        hasClaude: false,
        isMax20: false,
        hasOpenAI: false,
        hasGemini: true,
        hasCopilot: false,
        hasGeminiZen: false,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
      }

      // #when
      const result = generateOmgConfig(config)

      // #then Sisyphus uses Gemini
      expect(result.$schema).toBe("https://raw.githubusercontent.com/agi-explorer-sean/oh-my-gemini-harness/master/assets/oh-my-gemini.schema.json")
      expect(result.agents).toBeDefined()
      expect((result.agents as Record<string, { model: string }>).sisyphus.model).toBe("google/gemini-3-pro-preview")
    })
  })
})

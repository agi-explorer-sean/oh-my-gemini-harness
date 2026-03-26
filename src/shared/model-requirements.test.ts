import { describe, expect, test } from "bun:test"
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  type FallbackEntry,
  type ModelRequirement,
} from "./model-requirements"

describe("AGENT_MODEL_REQUIREMENTS", () => {
  test("oracle has valid fallbackChain with gemini-3-pro-preview as primary", () => {
    // given - oracle agent requirement
    const oracle = AGENT_MODEL_REQUIREMENTS["oracle"]

    // when - accessing oracle requirement
    // then - fallbackChain exists with gemini-3-pro-preview as first entry
    expect(oracle).toBeDefined()
    expect(oracle.fallbackChain).toBeArray()
    expect(oracle.fallbackChain.length).toBeGreaterThan(0)

    const primary = oracle.fallbackChain[0]
    expect(primary.providers).toContain("google")
    expect(primary.model).toBe("gemini-3-pro-preview")
    expect(primary.variant).toBe("max")
  })

  test("sisyphus has valid fallbackChain with gemini-3-pro-preview as primary and requiresAnyModel", () => {
    // #given - sisyphus agent requirement
    const sisyphus = AGENT_MODEL_REQUIREMENTS["sisyphus"]

    // #when - accessing Sisyphus requirement
    // #then - fallbackChain exists with gemini-3-pro-preview as first entry
    expect(sisyphus).toBeDefined()
    expect(sisyphus.fallbackChain).toBeArray()
    expect(sisyphus.fallbackChain).toHaveLength(2)
    expect(sisyphus.requiresAnyModel).toBe(true)

    const primary = sisyphus.fallbackChain[0]
    expect(primary.providers[0]).toBe("google")
    expect(primary.model).toBe("gemini-3-pro-preview")
    expect(primary.variant).toBe("max")
  })

  test("librarian has valid fallbackChain with gemini-3-flash-preview as primary", () => {
    // given - librarian agent requirement
    const librarian = AGENT_MODEL_REQUIREMENTS["librarian"]

    // when - accessing librarian requirement
    // then - fallbackChain exists with gemini-3-flash-preview as first entry
    expect(librarian).toBeDefined()
    expect(librarian.fallbackChain).toBeArray()
    expect(librarian.fallbackChain.length).toBeGreaterThan(0)

    const primary = librarian.fallbackChain[0]
    expect(primary.providers[0]).toBe("google")
    expect(primary.model).toBe("gemini-3-flash-preview")
  })

  test("explore has valid fallbackChain with gemini-3-flash-preview as primary", () => {
    // given - explore agent requirement
    const explore = AGENT_MODEL_REQUIREMENTS["explore"]

    // when - accessing explore requirement
    // then - fallbackChain exists with gemini-3-flash-preview as first entry
    expect(explore).toBeDefined()
    expect(explore.fallbackChain).toBeArray()
    expect(explore.fallbackChain).toHaveLength(2)

    const primary = explore.fallbackChain[0]
    expect(primary.providers).toContain("google")
    expect(primary.model).toBe("gemini-3-flash-preview")
  })

  test("multimodal-looker has valid fallbackChain with gemini-3-flash-preview as primary", () => {
    // given - multimodal-looker agent requirement
    const multimodalLooker = AGENT_MODEL_REQUIREMENTS["multimodal-looker"]

    // when - accessing multimodal-looker requirement
    // then - fallbackChain exists with gemini-3-flash-preview as first entry
    expect(multimodalLooker).toBeDefined()
    expect(multimodalLooker.fallbackChain).toBeArray()
    expect(multimodalLooker.fallbackChain.length).toBeGreaterThan(0)

    const primary = multimodalLooker.fallbackChain[0]
    expect(primary.providers[0]).toBe("google")
    expect(primary.model).toBe("gemini-3-flash-preview")
  })

  test("prometheus has valid fallbackChain with gemini-3-pro-preview as primary", () => {
    // given - prometheus agent requirement
    const prometheus = AGENT_MODEL_REQUIREMENTS["prometheus"]

    // when - accessing Prometheus requirement
    // then - fallbackChain exists with gemini-3-pro-preview as first entry
    expect(prometheus).toBeDefined()
    expect(prometheus.fallbackChain).toBeArray()
    expect(prometheus.fallbackChain.length).toBeGreaterThan(0)

    const primary = prometheus.fallbackChain[0]
    expect(primary.model).toBe("gemini-3-pro-preview")
    expect(primary.providers[0]).toBe("google")
  })

  test("metis has valid fallbackChain with gemini-3-pro-preview as primary", () => {
    // given - metis agent requirement
    const metis = AGENT_MODEL_REQUIREMENTS["metis"]

    // when - accessing Metis requirement
    // then - fallbackChain exists with gemini-3-pro-preview as first entry
    expect(metis).toBeDefined()
    expect(metis.fallbackChain).toBeArray()
    expect(metis.fallbackChain.length).toBeGreaterThan(0)

    const primary = metis.fallbackChain[0]
    expect(primary.model).toBe("gemini-3-pro-preview")
    expect(primary.providers[0]).toBe("google")
    expect(primary.variant).toBe("max")
  })

  test("momus has valid fallbackChain with gemini-3-pro-preview as primary", () => {
    // given - momus agent requirement
    const momus = AGENT_MODEL_REQUIREMENTS["momus"]

    // when - accessing Momus requirement
    // then - fallbackChain exists with gemini-3-pro-preview as first entry
    expect(momus).toBeDefined()
    expect(momus.fallbackChain).toBeArray()
    expect(momus.fallbackChain.length).toBeGreaterThan(0)

    const primary = momus.fallbackChain[0]
    expect(primary.model).toBe("gemini-3-pro-preview")
    expect(primary.variant).toBe("max")
    expect(primary.providers[0]).toBe("google")
  })

  test("atlas has valid fallbackChain with gemini-3-pro-preview as primary", () => {
    // given - atlas agent requirement
    const atlas = AGENT_MODEL_REQUIREMENTS["atlas"]

    // when - accessing Atlas requirement
    // then - fallbackChain exists with gemini-3-pro-preview as first entry
    expect(atlas).toBeDefined()
    expect(atlas.fallbackChain).toBeArray()
    expect(atlas.fallbackChain.length).toBeGreaterThan(0)

    const primary = atlas.fallbackChain[0]
    expect(primary.model).toBe("gemini-3-pro-preview")
    expect(primary.providers[0]).toBe("google")
  })

  test("hephaestus requires gemini-3-pro-preview", () => {
    // #given - hephaestus agent requirement
    const hephaestus = AGENT_MODEL_REQUIREMENTS["hephaestus"]

    // #when - accessing hephaestus requirement
    // #then - requiresModel is set to gemini-3-pro-preview
    expect(hephaestus).toBeDefined()
    expect(hephaestus.requiresModel).toBe("gemini-3-pro-preview")
  })

  test("all 10 builtin agents have valid fallbackChain arrays", () => {
    // #given - list of 10 agent names
    const expectedAgents = [
      "sisyphus",
      "hephaestus",
      "oracle",
      "librarian",
      "explore",
      "multimodal-looker",
      "prometheus",
      "metis",
      "momus",
      "atlas",
    ]

    // when - checking AGENT_MODEL_REQUIREMENTS
    const definedAgents = Object.keys(AGENT_MODEL_REQUIREMENTS)

    // #then - all agents present with valid fallbackChain
    expect(definedAgents).toHaveLength(10)
    for (const agent of expectedAgents) {
      const requirement = AGENT_MODEL_REQUIREMENTS[agent]
      expect(requirement).toBeDefined()
      expect(requirement.fallbackChain).toBeArray()
      expect(requirement.fallbackChain.length).toBeGreaterThan(0)

      for (const entry of requirement.fallbackChain) {
        expect(entry.providers).toBeArray()
        expect(entry.providers.length).toBeGreaterThan(0)
        expect(typeof entry.model).toBe("string")
        expect(entry.model.length).toBeGreaterThan(0)
      }
    }
  })
})

describe("CATEGORY_MODEL_REQUIREMENTS", () => {
  test("ultrabrain has valid fallbackChain with gemini-3-pro-preview as primary", () => {
    // given - ultrabrain category requirement
    const ultrabrain = CATEGORY_MODEL_REQUIREMENTS["ultrabrain"]

    // when - accessing ultrabrain requirement
    // then - fallbackChain exists with gemini-3-pro-preview as first entry
    expect(ultrabrain).toBeDefined()
    expect(ultrabrain.fallbackChain).toBeArray()
    expect(ultrabrain.fallbackChain.length).toBeGreaterThan(0)

    const primary = ultrabrain.fallbackChain[0]
    expect(primary.variant).toBe("max")
    expect(primary.model).toBe("gemini-3-pro-preview")
    expect(primary.providers[0]).toBe("google")
  })

  test("deep has valid fallbackChain with gemini-3-pro-preview as primary", () => {
    // given - deep category requirement
    const deep = CATEGORY_MODEL_REQUIREMENTS["deep"]

    // when - accessing deep requirement
    // then - fallbackChain exists with gemini-3-pro-preview as first entry
    expect(deep).toBeDefined()
    expect(deep.fallbackChain).toBeArray()
    expect(deep.fallbackChain.length).toBeGreaterThan(0)

    const primary = deep.fallbackChain[0]
    expect(primary.variant).toBe("max")
    expect(primary.model).toBe("gemini-3-pro-preview")
    expect(primary.providers[0]).toBe("google")
  })

  test("visual-engineering has valid fallbackChain with gemini-3-pro-preview as primary", () => {
    // given - visual-engineering category requirement
    const visualEngineering = CATEGORY_MODEL_REQUIREMENTS["visual-engineering"]

    // when - accessing visual-engineering requirement
    // then - fallbackChain exists with gemini-3-pro-preview as first entry
    expect(visualEngineering).toBeDefined()
    expect(visualEngineering.fallbackChain).toBeArray()
    expect(visualEngineering.fallbackChain.length).toBeGreaterThan(0)

    const primary = visualEngineering.fallbackChain[0]
    expect(primary.providers[0]).toBe("google")
    expect(primary.model).toBe("gemini-3-pro-preview")
  })

  test("quick has valid fallbackChain with gemini-3-flash-preview as primary", () => {
    // given - quick category requirement
    const quick = CATEGORY_MODEL_REQUIREMENTS["quick"]

    // when - accessing quick requirement
    // then - fallbackChain exists with gemini-3-flash-preview as first entry
    expect(quick).toBeDefined()
    expect(quick.fallbackChain).toBeArray()
    expect(quick.fallbackChain.length).toBeGreaterThan(0)

    const primary = quick.fallbackChain[0]
    expect(primary.model).toBe("gemini-3-flash-preview")
    expect(primary.providers[0]).toBe("google")
  })

  test("unspecified-low has valid fallbackChain with gemini-3-flash-preview as primary", () => {
    // given - unspecified-low category requirement
    const unspecifiedLow = CATEGORY_MODEL_REQUIREMENTS["unspecified-low"]

    // when - accessing unspecified-low requirement
    // then - fallbackChain exists with gemini-3-flash-preview as first entry
    expect(unspecifiedLow).toBeDefined()
    expect(unspecifiedLow.fallbackChain).toBeArray()
    expect(unspecifiedLow.fallbackChain.length).toBeGreaterThan(0)

    const primary = unspecifiedLow.fallbackChain[0]
    expect(primary.model).toBe("gemini-3-flash-preview")
    expect(primary.providers[0]).toBe("google")
  })

  test("unspecified-high has valid fallbackChain with gemini-3-pro-preview as primary", () => {
    // given - unspecified-high category requirement
    const unspecifiedHigh = CATEGORY_MODEL_REQUIREMENTS["unspecified-high"]

    // when - accessing unspecified-high requirement
    // then - fallbackChain exists with gemini-3-pro-preview as first entry
    expect(unspecifiedHigh).toBeDefined()
    expect(unspecifiedHigh.fallbackChain).toBeArray()
    expect(unspecifiedHigh.fallbackChain.length).toBeGreaterThan(0)

    const primary = unspecifiedHigh.fallbackChain[0]
    expect(primary.model).toBe("gemini-3-pro-preview")
    expect(primary.providers[0]).toBe("google")
  })

  test("artistry has valid fallbackChain with gemini-3-pro-preview as primary", () => {
    // given - artistry category requirement
    const artistry = CATEGORY_MODEL_REQUIREMENTS["artistry"]

    // when - accessing artistry requirement
    // then - fallbackChain exists with gemini-3-pro-preview as first entry
    expect(artistry).toBeDefined()
    expect(artistry.fallbackChain).toBeArray()
    expect(artistry.fallbackChain.length).toBeGreaterThan(0)

    const primary = artistry.fallbackChain[0]
    expect(primary.model).toBe("gemini-3-pro-preview")
    expect(primary.variant).toBe("max")
    expect(primary.providers[0]).toBe("google")
  })

  test("writing has valid fallbackChain with gemini-3-flash-preview as primary", () => {
    // given - writing category requirement
    const writing = CATEGORY_MODEL_REQUIREMENTS["writing"]

    // when - accessing writing requirement
    // then - fallbackChain exists with gemini-3-flash-preview as first entry
    expect(writing).toBeDefined()
    expect(writing.fallbackChain).toBeArray()
    expect(writing.fallbackChain.length).toBeGreaterThan(0)

    const primary = writing.fallbackChain[0]
    expect(primary.model).toBe("gemini-3-flash-preview")
    expect(primary.providers[0]).toBe("google")
  })

  test("all 8 categories have valid fallbackChain arrays", () => {
    // given - list of 8 category names
    const expectedCategories = [
      "visual-engineering",
      "ultrabrain",
      "deep",
      "artistry",
      "quick",
      "unspecified-low",
      "unspecified-high",
      "writing",
    ]

    // when - checking CATEGORY_MODEL_REQUIREMENTS
    const definedCategories = Object.keys(CATEGORY_MODEL_REQUIREMENTS)

    // then - all categories present with valid fallbackChain
    expect(definedCategories).toHaveLength(8)
    for (const category of expectedCategories) {
      const requirement = CATEGORY_MODEL_REQUIREMENTS[category]
      expect(requirement).toBeDefined()
      expect(requirement.fallbackChain).toBeArray()
      expect(requirement.fallbackChain.length).toBeGreaterThan(0)

      for (const entry of requirement.fallbackChain) {
        expect(entry.providers).toBeArray()
        expect(entry.providers.length).toBeGreaterThan(0)
        expect(typeof entry.model).toBe("string")
        expect(entry.model.length).toBeGreaterThan(0)
      }
    }
  })
})

describe("requiresModel field in categories", () => {
  test("deep category has requiresModel set to gemini-3-pro-preview", () => {
    // given
    const deep = CATEGORY_MODEL_REQUIREMENTS["deep"]

    // when / #then
    expect(deep.requiresModel).toBe("gemini-3-pro-preview")
  })

  test("artistry category has requiresModel set to gemini-3-pro-preview", () => {
    // given
    const artistry = CATEGORY_MODEL_REQUIREMENTS["artistry"]

    // when / #then
    expect(artistry.requiresModel).toBe("gemini-3-pro-preview")
  })
})

describe("FallbackEntry type", () => {
  test("FallbackEntry structure is correct", () => {
    // given - a valid FallbackEntry object
    const entry: FallbackEntry = {
      providers: ["google", "gemini"],
      model: "gemini-3-pro-preview",
      variant: "high",
    }

    // when - accessing properties
    // then - all properties are accessible
    expect(entry.providers).toEqual(["google", "gemini"])
    expect(entry.model).toBe("gemini-3-pro-preview")
    expect(entry.variant).toBe("high")
  })

  test("FallbackEntry variant is optional", () => {
    // given - a FallbackEntry without variant
    const entry: FallbackEntry = {
      providers: ["google"],
      model: "gemini-2.5-flash",
    }

    // when - accessing variant
    // then - variant is undefined
    expect(entry.variant).toBeUndefined()
  })
})

describe("ModelRequirement type", () => {
  test("ModelRequirement structure with fallbackChain is correct", () => {
    // given - a valid ModelRequirement object
    const requirement: ModelRequirement = {
      fallbackChain: [
        { providers: ["google", "gemini"], model: "gemini-3-pro-preview", variant: "max" },
        { providers: ["google"], model: "gemini-2.5-pro", variant: "high" },
      ],
    }

    // when - accessing properties
    // then - fallbackChain is accessible with correct structure
    expect(requirement.fallbackChain).toBeArray()
    expect(requirement.fallbackChain).toHaveLength(2)
    expect(requirement.fallbackChain[0].model).toBe("gemini-3-pro-preview")
    expect(requirement.fallbackChain[1].model).toBe("gemini-2.5-pro")
  })

  test("ModelRequirement variant is optional", () => {
    // given - a ModelRequirement without top-level variant
    const requirement: ModelRequirement = {
      fallbackChain: [{ providers: ["google"], model: "gemini-2.5-flash" }],
    }

    // when - accessing variant
    // then - variant is undefined
    expect(requirement.variant).toBeUndefined()
  })

  test("no model in fallbackChain has provider prefix", () => {
    // given - all agent and category requirements
    const allRequirements = [
      ...Object.values(AGENT_MODEL_REQUIREMENTS),
      ...Object.values(CATEGORY_MODEL_REQUIREMENTS),
    ]

    // when - checking each model in fallbackChain
    // then - none contain "/" (provider prefix)
    for (const req of allRequirements) {
      for (const entry of req.fallbackChain) {
        expect(entry.model).not.toContain("/")
      }
    }
  })

   test("all fallbackChain entries have non-empty providers array", () => {
     // given - all agent and category requirements
     const allRequirements = [
       ...Object.values(AGENT_MODEL_REQUIREMENTS),
       ...Object.values(CATEGORY_MODEL_REQUIREMENTS),
     ]

     // when - checking each entry in fallbackChain
     // then - all have non-empty providers array
     for (const req of allRequirements) {
       for (const entry of req.fallbackChain) {
         expect(entry.providers).toBeArray()
         expect(entry.providers.length).toBeGreaterThan(0)
       }
     }
   })
})

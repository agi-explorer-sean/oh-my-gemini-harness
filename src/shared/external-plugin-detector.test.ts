import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { detectExternalNotificationPlugin, getNotificationConflictWarning } from "./external-plugin-detector"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"

describe("external-plugin-detector", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omg-test-"))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe("detectExternalNotificationPlugin", () => {
    test("should return detected=false when no plugins configured", () => {
      // given - empty directory
      // when
      const result = detectExternalNotificationPlugin(tempDir)
      // then
      expect(result.detected).toBe(false)
      expect(result.pluginName).toBeNull()
    })

    test("should return detected=false when only oh-my-gemini is configured", () => {
      // given - gemini.json with only oh-my-gemini
      const geminiDir = path.join(tempDir, ".gemini")
      fs.mkdirSync(geminiDir, { recursive: true })
      fs.writeFileSync(
        path.join(geminiDir, "gemini.json"),
        JSON.stringify({ plugin: ["oh-my-gemini"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(false)
      expect(result.pluginName).toBeNull()
      expect(result.allPlugins).toContain("oh-my-gemini")
    })

    test("should detect gemini-notifier plugin", () => {
      // given - gemini.json with gemini-notifier
      const geminiDir = path.join(tempDir, ".gemini")
      fs.mkdirSync(geminiDir, { recursive: true })
      fs.writeFileSync(
        path.join(geminiDir, "gemini.json"),
        JSON.stringify({ plugin: ["oh-my-gemini", "gemini-notifier"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("gemini-notifier")
    })

    test("should detect gemini-notifier with version suffix", () => {
      // given - gemini.json with versioned gemini-notifier
      const geminiDir = path.join(tempDir, ".gemini")
      fs.mkdirSync(geminiDir, { recursive: true })
      fs.writeFileSync(
        path.join(geminiDir, "gemini.json"),
        JSON.stringify({ plugin: ["oh-my-gemini", "gemini-notifier@1.2.3"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("gemini-notifier")
    })

    test("should detect @mohak34/gemini-notifier", () => {
      // given - gemini.json with scoped package name
      const geminiDir = path.join(tempDir, ".gemini")
      fs.mkdirSync(geminiDir, { recursive: true })
      fs.writeFileSync(
        path.join(geminiDir, "gemini.json"),
        JSON.stringify({ plugin: ["oh-my-gemini", "@mohak34/gemini-notifier"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then - returns the matched known plugin pattern, not the full entry
      expect(result.detected).toBe(true)
      expect(result.pluginName).toContain("gemini-notifier")
    })

    test("should handle JSONC format with comments", () => {
      // given - gemini.jsonc with comments
      const geminiDir = path.join(tempDir, ".gemini")
      fs.mkdirSync(geminiDir, { recursive: true })
      fs.writeFileSync(
        path.join(geminiDir, "gemini.jsonc"),
        `{
          // This is a comment
          "plugin": [
            "oh-my-gemini",
            "gemini-notifier" // Another comment
          ]
        }`
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("gemini-notifier")
    })
  })

  describe("false positive prevention", () => {
    test("should NOT match my-gemini-notifier-fork (suffix variation)", () => {
      // given - plugin with similar name but different suffix
      const geminiDir = path.join(tempDir, ".gemini")
      fs.mkdirSync(geminiDir, { recursive: true })
      fs.writeFileSync(
        path.join(geminiDir, "gemini.json"),
        JSON.stringify({ plugin: ["my-gemini-notifier-fork"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(false)
      expect(result.pluginName).toBeNull()
    })

    test("should NOT match some-other-plugin/gemini-notifier-like (path with similar name)", () => {
      // given - plugin path containing similar substring
      const geminiDir = path.join(tempDir, ".gemini")
      fs.mkdirSync(geminiDir, { recursive: true })
      fs.writeFileSync(
        path.join(geminiDir, "gemini.json"),
        JSON.stringify({ plugin: ["some-other-plugin/gemini-notifier-like"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(false)
      expect(result.pluginName).toBeNull()
    })

    test("should NOT match gemini-notifier-extended (prefix match but different package)", () => {
      // given - plugin with prefix match but extended name
      const geminiDir = path.join(tempDir, ".gemini")
      fs.mkdirSync(geminiDir, { recursive: true })
      fs.writeFileSync(
        path.join(geminiDir, "gemini.json"),
        JSON.stringify({ plugin: ["gemini-notifier-extended"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(false)
      expect(result.pluginName).toBeNull()
    })

    test("should match gemini-notifier exactly", () => {
      // given - exact match
      const geminiDir = path.join(tempDir, ".gemini")
      fs.mkdirSync(geminiDir, { recursive: true })
      fs.writeFileSync(
        path.join(geminiDir, "gemini.json"),
        JSON.stringify({ plugin: ["gemini-notifier"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("gemini-notifier")
    })

    test("should match gemini-notifier@1.2.3 (version suffix)", () => {
      // given - version suffix
      const geminiDir = path.join(tempDir, ".gemini")
      fs.mkdirSync(geminiDir, { recursive: true })
      fs.writeFileSync(
        path.join(geminiDir, "gemini.json"),
        JSON.stringify({ plugin: ["gemini-notifier@1.2.3"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("gemini-notifier")
    })

    test("should match @mohak34/gemini-notifier (scoped package)", () => {
      // given - scoped package
      const geminiDir = path.join(tempDir, ".gemini")
      fs.mkdirSync(geminiDir, { recursive: true })
      fs.writeFileSync(
        path.join(geminiDir, "gemini.json"),
        JSON.stringify({ plugin: ["@mohak34/gemini-notifier"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toContain("gemini-notifier")
    })

    test("should match npm:gemini-notifier (npm prefix)", () => {
      // given - npm prefix
      const geminiDir = path.join(tempDir, ".gemini")
      fs.mkdirSync(geminiDir, { recursive: true })
      fs.writeFileSync(
        path.join(geminiDir, "gemini.json"),
        JSON.stringify({ plugin: ["npm:gemini-notifier"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("gemini-notifier")
    })

    test("should match npm:gemini-notifier@2.0.0 (npm prefix with version)", () => {
      // given - npm prefix with version
      const geminiDir = path.join(tempDir, ".gemini")
      fs.mkdirSync(geminiDir, { recursive: true })
      fs.writeFileSync(
        path.join(geminiDir, "gemini.json"),
        JSON.stringify({ plugin: ["npm:gemini-notifier@2.0.0"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("gemini-notifier")
    })

    test("should match file:///path/to/gemini-notifier (file path)", () => {
      // given - file path
      const geminiDir = path.join(tempDir, ".gemini")
      fs.mkdirSync(geminiDir, { recursive: true })
      fs.writeFileSync(
        path.join(geminiDir, "gemini.json"),
        JSON.stringify({ plugin: ["file:///home/user/plugins/gemini-notifier"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("gemini-notifier")
    })
  })

  describe("getNotificationConflictWarning", () => {
    test("should generate warning message with plugin name", () => {
      // when
      const warning = getNotificationConflictWarning("gemini-notifier")

      // then
      expect(warning).toContain("gemini-notifier")
      expect(warning).toContain("session.idle")
      expect(warning).toContain("auto-disabled")
      expect(warning).toContain("force_enable")
    })
  })
})

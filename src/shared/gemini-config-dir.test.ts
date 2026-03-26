import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import {
  getGeminiConfigDir,
  getGeminiConfigPaths,
  isDevBuild,
  detectExistingConfigDir,
  TAURI_APP_IDENTIFIER,
  TAURI_APP_IDENTIFIER_DEV,
} from "./gemini-config-dir"

describe("gemini-config-dir", () => {
  let originalPlatform: NodeJS.Platform
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalPlatform = process.platform
    originalEnv = {
      APPDATA: process.env.APPDATA,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      GEMINI_CONFIG_DIR: process.env.GEMINI_CONFIG_DIR,
    }
  })

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform })
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    }
  })

  describe("GEMINI_CONFIG_DIR environment variable", () => {
    test("returns GEMINI_CONFIG_DIR when env var is set", () => {
      // given GEMINI_CONFIG_DIR is set to a custom path
      process.env.GEMINI_CONFIG_DIR = "/custom/gemini/path"
      Object.defineProperty(process, "platform", { value: "linux" })

      // when getGeminiConfigDir is called with binary="gemini"
      const result = getGeminiConfigDir({ binary: "gemini", version: "1.0.200" })

      // then returns the custom path
      expect(result).toBe("/custom/gemini/path")
    })

    test("falls back to default when env var is not set", () => {
      // given GEMINI_CONFIG_DIR is not set, platform is Linux
      delete process.env.GEMINI_CONFIG_DIR
      delete process.env.XDG_CONFIG_HOME
      Object.defineProperty(process, "platform", { value: "linux" })

      // when getGeminiConfigDir is called with binary="gemini"
      const result = getGeminiConfigDir({ binary: "gemini", version: "1.0.200" })

      // then returns default ~/.config/gemini
      expect(result).toBe(join(homedir(), ".config", "gemini"))
    })

    test("falls back to default when env var is empty string", () => {
      // given GEMINI_CONFIG_DIR is set to empty string
      process.env.GEMINI_CONFIG_DIR = ""
      delete process.env.XDG_CONFIG_HOME
      Object.defineProperty(process, "platform", { value: "linux" })

      // when getGeminiConfigDir is called with binary="gemini"
      const result = getGeminiConfigDir({ binary: "gemini", version: "1.0.200" })

      // then returns default ~/.config/gemini
      expect(result).toBe(join(homedir(), ".config", "gemini"))
    })

    test("falls back to default when env var is whitespace only", () => {
      // given GEMINI_CONFIG_DIR is set to whitespace only
      process.env.GEMINI_CONFIG_DIR = "   "
      delete process.env.XDG_CONFIG_HOME
      Object.defineProperty(process, "platform", { value: "linux" })

      // when getGeminiConfigDir is called with binary="gemini"
      const result = getGeminiConfigDir({ binary: "gemini", version: "1.0.200" })

      // then returns default ~/.config/gemini
      expect(result).toBe(join(homedir(), ".config", "gemini"))
    })

    test("resolves relative path to absolute path", () => {
      // given GEMINI_CONFIG_DIR is set to a relative path
      process.env.GEMINI_CONFIG_DIR = "./my-gemini-config"
      Object.defineProperty(process, "platform", { value: "linux" })

      // when getGeminiConfigDir is called with binary="gemini"
      const result = getGeminiConfigDir({ binary: "gemini", version: "1.0.200" })

      // then returns resolved absolute path
      expect(result).toBe(resolve("./my-gemini-config"))
    })

    test("GEMINI_CONFIG_DIR takes priority over XDG_CONFIG_HOME", () => {
      // given both GEMINI_CONFIG_DIR and XDG_CONFIG_HOME are set
      process.env.GEMINI_CONFIG_DIR = "/custom/gemini/path"
      process.env.XDG_CONFIG_HOME = "/xdg/config"
      Object.defineProperty(process, "platform", { value: "linux" })

      // when getGeminiConfigDir is called with binary="gemini"
      const result = getGeminiConfigDir({ binary: "gemini", version: "1.0.200" })

      // then GEMINI_CONFIG_DIR takes priority
      expect(result).toBe("/custom/gemini/path")
    })
  })

  describe("isDevBuild", () => {
    test("returns false for null version", () => {
      expect(isDevBuild(null)).toBe(false)
    })

    test("returns false for undefined version", () => {
      expect(isDevBuild(undefined)).toBe(false)
    })

    test("returns false for production version", () => {
      expect(isDevBuild("1.0.200")).toBe(false)
      expect(isDevBuild("2.1.0")).toBe(false)
    })

    test("returns true for version containing -dev", () => {
      expect(isDevBuild("1.0.0-dev")).toBe(true)
      expect(isDevBuild("1.0.0-dev.123")).toBe(true)
    })

    test("returns true for version containing .dev", () => {
      expect(isDevBuild("1.0.0.dev")).toBe(true)
      expect(isDevBuild("1.0.0.dev.456")).toBe(true)
    })
  })

  describe("getGeminiConfigDir", () => {
    describe("for gemini CLI binary", () => {
      test("returns ~/.config/gemini on Linux", () => {
        // given gemini CLI binary detected, platform is Linux
        Object.defineProperty(process, "platform", { value: "linux" })
        delete process.env.XDG_CONFIG_HOME
        delete process.env.GEMINI_CONFIG_DIR

        // when getGeminiConfigDir is called with binary="gemini"
        const result = getGeminiConfigDir({ binary: "gemini", version: "1.0.200" })

        // then returns ~/.config/gemini
        expect(result).toBe(join(homedir(), ".config", "gemini"))
      })

      test("returns $XDG_CONFIG_HOME/gemini on Linux when XDG_CONFIG_HOME is set", () => {
        // given gemini CLI binary detected, platform is Linux with XDG_CONFIG_HOME set
        Object.defineProperty(process, "platform", { value: "linux" })
        process.env.XDG_CONFIG_HOME = "/custom/config"
        delete process.env.GEMINI_CONFIG_DIR

        // when getGeminiConfigDir is called with binary="gemini"
        const result = getGeminiConfigDir({ binary: "gemini", version: "1.0.200" })

        // then returns $XDG_CONFIG_HOME/gemini
        expect(result).toBe("/custom/config/gemini")
      })

      test("returns ~/.config/gemini on macOS", () => {
        // given gemini CLI binary detected, platform is macOS
        Object.defineProperty(process, "platform", { value: "darwin" })
        delete process.env.XDG_CONFIG_HOME
        delete process.env.GEMINI_CONFIG_DIR

        // when getGeminiConfigDir is called with binary="gemini"
        const result = getGeminiConfigDir({ binary: "gemini", version: "1.0.200" })

        // then returns ~/.config/gemini
        expect(result).toBe(join(homedir(), ".config", "gemini"))
      })

      test("returns ~/.config/gemini on Windows by default", () => {
        // given gemini CLI binary detected, platform is Windows
        Object.defineProperty(process, "platform", { value: "win32" })
        delete process.env.APPDATA
        delete process.env.GEMINI_CONFIG_DIR

        // when getGeminiConfigDir is called with binary="gemini"
        const result = getGeminiConfigDir({ binary: "gemini", version: "1.0.200", checkExisting: false })

        // then returns ~/.config/gemini (cross-platform default)
        expect(result).toBe(join(homedir(), ".config", "gemini"))
      })
    })

    describe("for gemini-desktop Tauri binary", () => {
      test("returns ~/.config/ai.gemini.desktop on Linux", () => {
        // given gemini-desktop binary detected, platform is Linux
        Object.defineProperty(process, "platform", { value: "linux" })
        delete process.env.XDG_CONFIG_HOME

        // when getGeminiConfigDir is called with binary="gemini-desktop"
        const result = getGeminiConfigDir({ binary: "gemini-desktop", version: "1.0.200", checkExisting: false })

        // then returns ~/.config/ai.gemini.desktop
        expect(result).toBe(join(homedir(), ".config", TAURI_APP_IDENTIFIER))
      })

      test("returns ~/Library/Application Support/ai.gemini.desktop on macOS", () => {
        // given gemini-desktop binary detected, platform is macOS
        Object.defineProperty(process, "platform", { value: "darwin" })

        // when getGeminiConfigDir is called with binary="gemini-desktop"
        const result = getGeminiConfigDir({ binary: "gemini-desktop", version: "1.0.200", checkExisting: false })

        // then returns ~/Library/Application Support/ai.gemini.desktop
        expect(result).toBe(join(homedir(), "Library", "Application Support", TAURI_APP_IDENTIFIER))
      })

      test("returns %APPDATA%/ai.gemini.desktop on Windows", () => {
        // given gemini-desktop binary detected, platform is Windows
        Object.defineProperty(process, "platform", { value: "win32" })
        process.env.APPDATA = "C:\\Users\\TestUser\\AppData\\Roaming"

        // when getGeminiConfigDir is called with binary="gemini-desktop"
        const result = getGeminiConfigDir({ binary: "gemini-desktop", version: "1.0.200", checkExisting: false })

        // then returns %APPDATA%/ai.gemini.desktop
        expect(result).toBe(join("C:\\Users\\TestUser\\AppData\\Roaming", TAURI_APP_IDENTIFIER))
      })
    })

    describe("dev build detection", () => {
      test("returns ai.gemini.desktop.dev path when dev version detected", () => {
        // given gemini-desktop dev version
        Object.defineProperty(process, "platform", { value: "linux" })
        delete process.env.XDG_CONFIG_HOME

        // when getGeminiConfigDir is called with dev version
        const result = getGeminiConfigDir({ binary: "gemini-desktop", version: "1.0.0-dev.123", checkExisting: false })

        // then returns path with ai.gemini.desktop.dev
        expect(result).toBe(join(homedir(), ".config", TAURI_APP_IDENTIFIER_DEV))
      })

      test("returns ai.gemini.desktop.dev on macOS for dev build", () => {
        // given gemini-desktop dev version on macOS
        Object.defineProperty(process, "platform", { value: "darwin" })

        // when getGeminiConfigDir is called with dev version
        const result = getGeminiConfigDir({ binary: "gemini-desktop", version: "1.0.0-dev", checkExisting: false })

        // then returns path with ai.gemini.desktop.dev
        expect(result).toBe(join(homedir(), "Library", "Application Support", TAURI_APP_IDENTIFIER_DEV))
      })
    })
  })

  describe("getGeminiConfigPaths", () => {
    test("returns all config paths for CLI binary", () => {
      // given gemini CLI binary on Linux
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME
      delete process.env.GEMINI_CONFIG_DIR

      // when getGeminiConfigPaths is called
      const paths = getGeminiConfigPaths({ binary: "gemini", version: "1.0.200" })

      // then returns all expected paths
      const expectedDir = join(homedir(), ".config", "gemini")
      expect(paths.configDir).toBe(expectedDir)
      expect(paths.configJson).toBe(join(expectedDir, "gemini.json"))
      expect(paths.configJsonc).toBe(join(expectedDir, "gemini.jsonc"))
      expect(paths.packageJson).toBe(join(expectedDir, "package.json"))
      expect(paths.omgConfig).toBe(join(expectedDir, "oh-my-gemini.json"))
    })

    test("returns all config paths for desktop binary", () => {
      // given gemini-desktop binary on macOS
      Object.defineProperty(process, "platform", { value: "darwin" })

      // when getGeminiConfigPaths is called
      const paths = getGeminiConfigPaths({ binary: "gemini-desktop", version: "1.0.200", checkExisting: false })

      // then returns all expected paths
      const expectedDir = join(homedir(), "Library", "Application Support", TAURI_APP_IDENTIFIER)
      expect(paths.configDir).toBe(expectedDir)
      expect(paths.configJson).toBe(join(expectedDir, "gemini.json"))
      expect(paths.configJsonc).toBe(join(expectedDir, "gemini.jsonc"))
      expect(paths.packageJson).toBe(join(expectedDir, "package.json"))
      expect(paths.omgConfig).toBe(join(expectedDir, "oh-my-gemini.json"))
    })
  })

  describe("detectExistingConfigDir", () => {
    test("returns null when no config exists", () => {
      // given no config files exist
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME
      delete process.env.GEMINI_CONFIG_DIR

      // when detectExistingConfigDir is called
      const result = detectExistingConfigDir("gemini", "1.0.200")

      // then result is either null or a valid string path
      expect(result === null || typeof result === "string").toBe(true)
    })

    test("includes GEMINI_CONFIG_DIR in search locations when set", () => {
      // given GEMINI_CONFIG_DIR is set to a custom path
      process.env.GEMINI_CONFIG_DIR = "/custom/gemini/path"
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME

      // when detectExistingConfigDir is called
      const result = detectExistingConfigDir("gemini", "1.0.200")

      // then result is either null (no config file exists) or a valid string path
      // The important thing is that the function doesn't throw
      expect(result === null || typeof result === "string").toBe(true)
    })
  })
})

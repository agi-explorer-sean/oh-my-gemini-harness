import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createRalphLoopHook, handleAfterAgent, injectTests } from "./index"
import { readState, writeState, clearState } from "./storage"
import type { RalphLoopState } from "./types"

describe("ralph-loop", () => {
  const TEST_DIR = join(tmpdir(), "ralph-loop-test-" + Date.now())

  function createMockPluginInput() {
    return {
      client: {
        session: {
          prompt: async () => ({}),
          messages: async () => ({ data: [] }),
        },
        tui: {
          showToast: async () => ({}),
        },
      },
      directory: TEST_DIR,
    } as unknown as Parameters<typeof createRalphLoopHook>[0]
  }

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true })
    }

    clearState(TEST_DIR)
  })

  afterEach(() => {
    clearState(TEST_DIR)
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("storage", () => {
    test("should write and read state correctly as JSON", () => {
      // given - a state object
      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 50,
        completion_promise: "DONE",
        started_at: "2025-12-30T01:00:00Z",
        prompt: "Build a REST API",
        session_id: "test-session-123",
      }

      // when - write and read state
      const writeSuccess = writeState(TEST_DIR, state)
      const readResult = readState(TEST_DIR)

      // then - state should match
      expect(writeSuccess).toBe(true)
      expect(readResult).not.toBeNull()
      expect(readResult?.active).toBe(true)
      expect(readResult?.iteration).toBe(1)
      expect(readResult?.max_iterations).toBe(50)
      expect(readResult?.completion_promise).toBe("DONE")
      expect(readResult?.prompt).toBe("Build a REST API")
      expect(readResult?.session_id).toBe("test-session-123")
    })

    test("should handle ultrawork field", () => {
      // given - a state object with ultrawork enabled
      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 50,
        completion_promise: "DONE",
        started_at: "2025-12-30T01:00:00Z",
        prompt: "Build a REST API",
        session_id: "test-session-123",
        ultrawork: true,
      }

      // when - write and read state
      writeState(TEST_DIR, state)
      const readResult = readState(TEST_DIR)

      // then - ultrawork field should be preserved
      expect(readResult?.ultrawork).toBe(true)
    })

    test("should return null for non-existent state", () => {
      // given - no state file exists
      // when - read state
      const result = readState(TEST_DIR)

      // then - should return null
      expect(result).toBeNull()
    })

    test("should clear state correctly", () => {
      // given - existing state
      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 50,
        completion_promise: "DONE",
        started_at: "2025-12-30T01:00:00Z",
        prompt: "Test prompt",
      }
      writeState(TEST_DIR, state)

      // when - clear state
      const clearSuccess = clearState(TEST_DIR)
      const readResult = readState(TEST_DIR)

      // then - state should be cleared
      expect(clearSuccess).toBe(true)
      expect(readResult).toBeNull()
    })

    test("should handle multiline prompts", () => {
      // given - state with multiline prompt
      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "FINISHED",
        started_at: "2025-12-30T02:00:00Z",
        prompt: "Build a feature\nwith multiple lines\nand requirements",
      }

      // when - write and read
      writeState(TEST_DIR, state)
      const readResult = readState(TEST_DIR)

      // then - multiline prompt preserved
      expect(readResult?.prompt).toBe("Build a feature\nwith multiple lines\nand requirements")
    })

    test("should read legacy frontmatter state for migration", () => {
      // given - state in old frontmatter format
      const stateDir = join(TEST_DIR, ".sisyphus")
      mkdirSync(stateDir, { recursive: true })
      const filePath = join(stateDir, "ralph-loop.json")
      const frontmatterContent = `---
active: true
iteration: 3
max_iterations: 50
completion_promise: "DONE"
started_at: "2025-12-30T01:00:00Z"
session_id: "legacy-session"
---
Build a REST API`
      writeFileSync(filePath, frontmatterContent, "utf-8")

      // when - read state
      const readResult = readState(TEST_DIR)

      // then - should parse frontmatter fallback
      expect(readResult).not.toBeNull()
      expect(readResult?.active).toBe(true)
      expect(readResult?.iteration).toBe(3)
      expect(readResult?.prompt).toBe("Build a REST API")
      expect(readResult?.session_id).toBe("legacy-session")
    })
  })

  describe("handleAfterAgent", () => {
    test("should return allow when no loop is active", () => {
      // given - no active loop state
      // when - handleAfterAgent called
      const result = handleAfterAgent(TEST_DIR, "test prompt", "test response", false)

      // then - should allow
      expect(result.decision).toBe("allow")
      expect(result.reason).toBeUndefined()
    })

    test("should return allow when stopHookActive is true", () => {
      // given - active loop
      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "DONE",
        started_at: new Date().toISOString(),
        prompt: "Build something",
      }
      writeState(TEST_DIR, state)

      // when - handleAfterAgent called with stopHookActive=true
      const result = handleAfterAgent(TEST_DIR, "test prompt", "test response", true)

      // then - should allow (prevent infinite recursion)
      expect(result.decision).toBe("allow")
      expect(result.reason).toBeUndefined()
    })

    test("should detect completion promise in promptResponse", () => {
      // given - active loop
      const state: RalphLoopState = {
        active: true,
        iteration: 2,
        max_iterations: 10,
        completion_promise: "DONE",
        started_at: new Date().toISOString(),
        prompt: "Build something",
      }
      writeState(TEST_DIR, state)

      // when - promptResponse contains the completion promise
      const result = handleAfterAgent(
        TEST_DIR,
        "test prompt",
        "I have finished the task. <promise>DONE</promise>",
        false,
      )

      // then - should allow and signal completion
      expect(result.decision).toBe("allow")
      expect(result.continue).toBe(false)
      expect(result.systemMessage).toContain("complete")
      // then - state should be cleared
      expect(readState(TEST_DIR)).toBeNull()
    })

    test("should detect completion promise with whitespace", () => {
      // given - active loop
      const state: RalphLoopState = {
        active: true,
        iteration: 2,
        max_iterations: 10,
        completion_promise: "FINISHED",
        started_at: new Date().toISOString(),
        prompt: "Build something",
      }
      writeState(TEST_DIR, state)

      // when - promptResponse has whitespace around promise token
      const result = handleAfterAgent(
        TEST_DIR,
        "test prompt",
        "Done! <promise> FINISHED </promise>",
        false,
      )

      // then - should detect completion
      expect(result.decision).toBe("allow")
      expect(result.continue).toBe(false)
    })

    test("should return deny with clearContext when loop should continue", () => {
      // given - active loop at iteration 1
      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "DONE",
        started_at: new Date().toISOString(),
        prompt: "Build a feature",
      }
      writeState(TEST_DIR, state)

      // when - promptResponse does NOT contain completion promise
      const result = handleAfterAgent(
        TEST_DIR,
        "test prompt",
        "I made some progress but not done yet",
        false,
      )

      // then - should deny with continuation prompt and clear context
      expect(result.decision).toBe("deny")
      expect(result.reason).toContain("RALPH LOOP 2/10")
      expect(result.reason).toContain("Build a feature")
      expect(result.reason).toContain("<promise>DONE</promise>")
      expect(result.hookSpecificOutput).toEqual({
        hookEventName: "AfterAgent",
        clearContext: true,
      })
    })

    test("should increment iteration counter", () => {
      // given - active loop at iteration 1
      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "DONE",
        started_at: new Date().toISOString(),
        prompt: "Build something",
      }
      writeState(TEST_DIR, state)

      // when - handleAfterAgent triggers continuation
      handleAfterAgent(TEST_DIR, "prompt", "no promise", false)

      // then - iteration should be incremented to 2
      const updatedState = readState(TEST_DIR)
      expect(updatedState?.iteration).toBe(2)
    })

    test("should stop loop when max iterations reached", () => {
      // given - loop at max iteration
      const state: RalphLoopState = {
        active: true,
        iteration: 5,
        max_iterations: 5,
        completion_promise: "DONE",
        started_at: new Date().toISOString(),
        prompt: "Build something",
      }
      writeState(TEST_DIR, state)

      // when - handleAfterAgent called
      const result = handleAfterAgent(TEST_DIR, "prompt", "no promise", false)

      // then - should allow and signal stop
      expect(result.decision).toBe("allow")
      expect(result.continue).toBe(false)
      expect(result.systemMessage).toContain("max iterations")
      expect(result.systemMessage).toContain("5")
      // then - state should be cleared
      expect(readState(TEST_DIR)).toBeNull()
    })

    test("should show ultrawork completion message", () => {
      // given - active ultrawork loop with completion
      const state: RalphLoopState = {
        active: true,
        iteration: 2,
        max_iterations: 10,
        completion_promise: "DONE",
        started_at: new Date().toISOString(),
        prompt: "Build API",
        ultrawork: true,
      }
      writeState(TEST_DIR, state)

      // when - promptResponse contains completion
      const result = handleAfterAgent(
        TEST_DIR,
        "prompt",
        "<promise>DONE</promise>",
        false,
      )

      // then - should show ultrawork message
      expect(result.systemMessage).toContain("ULTRAWORK LOOP")
      expect(result.systemMessage).toContain("JUST ULW ULW!")
    })

    test("should show regular completion message when ultrawork disabled", () => {
      // given - non-ultrawork loop with completion
      const state: RalphLoopState = {
        active: true,
        iteration: 2,
        max_iterations: 10,
        completion_promise: "DONE",
        started_at: new Date().toISOString(),
        prompt: "Build API",
      }
      writeState(TEST_DIR, state)

      // when
      const result = handleAfterAgent(
        TEST_DIR,
        "prompt",
        "<promise>DONE</promise>",
        false,
      )

      // then
      expect(result.systemMessage).toContain("Ralph Loop")
      expect(result.systemMessage).not.toContain("ULTRAWORK")
    })

    test("should prepend ultrawork to continuation prompt when ultrawork=true", () => {
      // given - active ultrawork loop
      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "DONE",
        started_at: new Date().toISOString(),
        prompt: "Build API",
        ultrawork: true,
      }
      writeState(TEST_DIR, state)

      // when - continuation triggered
      const result = handleAfterAgent(TEST_DIR, "prompt", "no promise", false)

      // then - reason should start with "ultrawork "
      expect(result.decision).toBe("deny")
      expect(result.reason).toMatch(/^ultrawork /)
    })

    test("should NOT prepend ultrawork when ultrawork is not set", () => {
      // given - non-ultrawork loop
      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "DONE",
        started_at: new Date().toISOString(),
        prompt: "Build API",
      }
      writeState(TEST_DIR, state)

      // when - continuation triggered
      const result = handleAfterAgent(TEST_DIR, "prompt", "no promise", false)

      // then - reason should NOT start with "ultrawork "
      expect(result.decision).toBe("deny")
      expect(result.reason).not.toMatch(/^ultrawork /)
    })

    test("should handle multiple iterations correctly", () => {
      // given - active loop
      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 5,
        completion_promise: "DONE",
        started_at: new Date().toISOString(),
        prompt: "Build feature",
      }
      writeState(TEST_DIR, state)

      // when - two iterations
      const result1 = handleAfterAgent(TEST_DIR, "p", "no promise", false)
      const result2 = handleAfterAgent(TEST_DIR, "p", "no promise", false)

      // then - iterations increment
      expect(result1.decision).toBe("deny")
      expect(result1.reason).toContain("2/5")
      expect(result2.decision).toBe("deny")
      expect(result2.reason).toContain("3/5")
      expect(readState(TEST_DIR)?.iteration).toBe(3)
    })

    test("should include prompt and promise in continuation message", () => {
      // given - loop with specific prompt and promise
      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "CALCULATOR_DONE",
        started_at: new Date().toISOString(),
        prompt: "Create a calculator app",
      }
      writeState(TEST_DIR, state)

      // when - continuation triggered
      const result = handleAfterAgent(TEST_DIR, "p", "working...", false)

      // then - continuation includes original task and promise
      expect(result.reason).toContain("Create a calculator app")
      expect(result.reason).toContain("<promise>CALCULATOR_DONE</promise>")
    })

    test("should inject tests on first continuation when inject_tests_from is configured", () => {
      // given - active loop with test injection configured
      const testSrcDir = join(TEST_DIR, "test-fixtures")
      const testDestDir = join(TEST_DIR, "workspace")
      mkdirSync(testSrcDir, { recursive: true })
      mkdirSync(testDestDir, { recursive: true })
      writeFileSync(join(testSrcDir, "emitter_test.go"), "package workflow\n")
      writeFileSync(join(testSrcDir, "context_test.go"), "package workflow\n")

      const state: RalphLoopState = {
        active: true,
        iteration: 1,
        max_iterations: 10,
        completion_promise: "RALPH_DONE",
        started_at: new Date().toISOString(),
        prompt: "Implement workflow engine",
        inject_tests_from: testSrcDir,
        inject_tests_to: testDestDir,
      }
      writeState(TEST_DIR, state)

      // when - first continuation (no promise found)
      const result = handleAfterAgent(TEST_DIR, "p", "implemented modules", false)

      // then - tests injected and continuation uses injection prompt
      expect(result.decision).toBe("deny")
      expect(result.reason).toContain("TESTS INJECTED")
      expect(result.reason).toContain("go test")
      expect(existsSync(join(testDestDir, "emitter_test.go"))).toBe(true)
      expect(existsSync(join(testDestDir, "context_test.go"))).toBe(true)

      // then - state should have tests_injected=true
      const updatedState = readState(TEST_DIR)
      expect(updatedState?.tests_injected).toBe(true)
    })

    test("should not re-inject tests on subsequent continuations", () => {
      // given - loop with tests already injected
      const testSrcDir = join(TEST_DIR, "test-fixtures-2")
      const testDestDir = join(TEST_DIR, "workspace-2")
      mkdirSync(testSrcDir, { recursive: true })
      mkdirSync(testDestDir, { recursive: true })
      writeFileSync(join(testSrcDir, "emitter_test.go"), "package workflow\n")

      const state: RalphLoopState = {
        active: true,
        iteration: 2,
        max_iterations: 10,
        completion_promise: "RALPH_DONE",
        started_at: new Date().toISOString(),
        prompt: "Implement workflow engine",
        inject_tests_from: testSrcDir,
        inject_tests_to: testDestDir,
        tests_injected: true,
      }
      writeState(TEST_DIR, state)

      // when - subsequent continuation
      const result = handleAfterAgent(TEST_DIR, "p", "still working", false)

      // then - should use normal continuation prompt (not injection prompt)
      expect(result.decision).toBe("deny")
      expect(result.reason).not.toContain("TESTS INJECTED")
      expect(result.reason).toContain("RALPH LOOP")
    })
  })

  describe("injectTests", () => {
    test("should copy test files from source to target directory", () => {
      // given - source dir with test files
      const srcDir = join(TEST_DIR, "inject-src")
      const destDir = join(TEST_DIR, "inject-dest")
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, "emitter_test.go"), "package workflow\n")
      writeFileSync(join(srcDir, "context_test.go"), "package workflow\n")
      writeFileSync(join(srcDir, "README.md"), "not a test\n")

      // when - inject tests
      const count = injectTests(srcDir, destDir)

      // then - only test files copied
      expect(count).toBe(2)
      expect(existsSync(join(destDir, "emitter_test.go"))).toBe(true)
      expect(existsSync(join(destDir, "context_test.go"))).toBe(true)
      expect(existsSync(join(destDir, "README.md"))).toBe(false)
    })

    test("should return 0 when source directory does not exist", () => {
      // given - non-existent source
      const count = injectTests(join(TEST_DIR, "nonexistent"), join(TEST_DIR, "dest"))

      // then
      expect(count).toBe(0)
    })

    test("should create target directory if it does not exist", () => {
      // given - source dir with test file, no target dir
      const srcDir = join(TEST_DIR, "inject-src-2")
      const destDir = join(TEST_DIR, "inject-dest-2", "nested")
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, "runner_test.go"), "package workflow\n")

      // when
      const count = injectTests(srcDir, destDir)

      // then
      expect(count).toBe(1)
      expect(existsSync(join(destDir, "runner_test.go"))).toBe(true)
    })
  })

  describe("hook lifecycle", () => {
    test("should start loop and write state", () => {
      // given - hook instance
      const hook = createRalphLoopHook(createMockPluginInput())

      // when - start loop
      const success = hook.startLoop("session-123", "Build something", {
        maxIterations: 25,
        completionPromise: "FINISHED",
      })

      // then - state should be written
      expect(success).toBe(true)
      const state = hook.getState()
      expect(state?.active).toBe(true)
      expect(state?.iteration).toBe(1)
      expect(state?.max_iterations).toBe(25)
      expect(state?.completion_promise).toBe("FINISHED")
      expect(state?.prompt).toBe("Build something")
      expect(state?.session_id).toBe("session-123")
    })

    test("should accept ultrawork option in startLoop", () => {
      // given - hook instance
      const hook = createRalphLoopHook(createMockPluginInput())

      // when - start loop with ultrawork
      hook.startLoop("session-123", "Build something", { ultrawork: true })

      // then - state should have ultrawork=true
      const state = hook.getState()
      expect(state?.ultrawork).toBe(true)
    })

    test("should handle missing ultrawork option in startLoop", () => {
      // given - hook instance
      const hook = createRalphLoopHook(createMockPluginInput())

      // when - start loop without ultrawork
      hook.startLoop("session-123", "Build something")

      // then - state should have ultrawork=undefined
      const state = hook.getState()
      expect(state?.ultrawork).toBeUndefined()
    })

    test("should cancel active loop", () => {
      // given - active loop
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-123", "Test task")

      // when - cancel loop
      const success = hook.cancelLoop()

      // then - loop cancelled
      expect(success).toBe(true)
      expect(hook.getState()).toBeNull()
    })

    test("should return false when cancelling with no active loop", () => {
      // given - no active loop
      const hook = createRalphLoopHook(createMockPluginInput())

      // when - try to cancel
      const success = hook.cancelLoop()

      // then - cancel should fail
      expect(success).toBe(false)
    })

    test("should use default config values", () => {
      // given - hook with config
      const hook = createRalphLoopHook(createMockPluginInput(), {
        config: {
          enabled: true,
          default_max_iterations: 200,
        },
      })

      // when - start loop without options
      hook.startLoop("session-123", "Test task")

      // then - should use config defaults
      const state = hook.getState()
      expect(state?.max_iterations).toBe(200)
    })

    test("should allow starting new loop in same session (restart)", () => {
      // given - active loop at iteration 3
      const hook = createRalphLoopHook(createMockPluginInput())
      hook.startLoop("session-A", "First task", { maxIterations: 10 })

      // Simulate some iterations via handleAfterAgent
      handleAfterAgent(TEST_DIR, "p", "no promise", false)
      handleAfterAgent(TEST_DIR, "p", "no promise", false)
      expect(hook.getState()?.iteration).toBe(3)

      // when - start NEW loop in same session (restart)
      hook.startLoop("session-A", "Restarted task", { maxIterations: 50 })

      // then - state should be reset
      expect(hook.getState()?.session_id).toBe("session-A")
      expect(hook.getState()?.prompt).toBe("Restarted task")
      expect(hook.getState()?.max_iterations).toBe(50)
      expect(hook.getState()?.iteration).toBe(1)
    })
  })
})

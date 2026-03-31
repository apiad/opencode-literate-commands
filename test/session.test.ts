/**
 * Session state tests
 */

import { describe, it, expect } from "vitest"
import {
  createSessionState,
  advanceStep,
  routeToStep,
  updateMetadata,
  isSessionComplete,
  getCurrentStep,
  enterAwaitingResponse,
  resetAwaitingState,
  enterAwaitingRetry,
  hasRetries,
  buildRetryPrompt,
  buildStopPrompt,
} from "../src/session.js"
import type { Step } from "../src/types.js"

const createTestStep = (name: string): Step => ({
  config: { step: name },
  prompt: `Step ${name}`,
  codeBlocks: [],
})

describe("createSessionState", () => {
  it("should create session state with steps", () => {
    const steps = [createTestStep("step1"), createTestStep("step2")]
    const state = createSessionState("session-1", "test-cmd", steps, "--arg")

    expect(state.sessionID).toBe("session-1")
    expect(state.commandName).toBe("test-cmd")
    expect(state.steps).toHaveLength(2)
    expect(state.currentStep).toBe(0)
    expect(state.metadata.ARGUMENTS).toBe("--arg")
    expect(state.retries).toBe(3)
    expect(state.awaitingResponse).toBe(false)
  })
})

describe("advanceStep", () => {
  it("should increment current step", () => {
    const state = createSessionState("s1", "cmd", [createTestStep("s1"), createTestStep("s2")])
    expect(state.currentStep).toBe(0)

    advanceStep(state)
    expect(state.currentStep).toBe(1)

    advanceStep(state)
    expect(state.currentStep).toBe(2)
  })
})

describe("routeToStep", () => {
  it("should route to named step", () => {
    const state = createSessionState("s1", "cmd", [
      createTestStep("start"),
      createTestStep("middle"),
      createTestStep("end"),
    ])

    expect(routeToStep(state, "middle")).toBe(true)
    expect(state.currentStep).toBe(1)

    expect(routeToStep(state, "end")).toBe(true)
    expect(state.currentStep).toBe(2)
  })

  it("should return false for missing step", () => {
    const state = createSessionState("s1", "cmd", [createTestStep("start")])
    expect(routeToStep(state, "missing")).toBe(false)
  })
})

describe("updateMetadata", () => {
  it("should merge data into metadata", () => {
    const state = createSessionState("s1", "cmd", [createTestStep("s1")])
    expect(state.metadata.name).toBeUndefined()

    updateMetadata(state, { name: "Alice", count: 5 })
    expect(state.metadata.name).toBe("Alice")
    expect(state.metadata.count).toBe(5)
  })
})

describe("isSessionComplete", () => {
  it("should return true when past last step", () => {
    const state = createSessionState("s1", "cmd", [createTestStep("s1")])
    expect(isSessionComplete(state)).toBe(false)

    state.currentStep = 1
    expect(isSessionComplete(state)).toBe(true)
  })
})

describe("getCurrentStep", () => {
  it("should return current step", () => {
    const steps = [createTestStep("s1"), createTestStep("s2")]
    const state = createSessionState("s1", "cmd", steps)

    expect(getCurrentStep(state)?.config.step).toBe("s1")

    advanceStep(state)
    expect(getCurrentStep(state)?.config.step).toBe("s2")
  })

  it("should return undefined when complete", () => {
    const state = createSessionState("s1", "cmd", [createTestStep("s1")])
    state.currentStep = 1
    expect(getCurrentStep(state)).toBeUndefined()
  })
})

describe("enterAwaitingResponse", () => {
  it("should set awaitingResponse state", () => {
    const state = createSessionState("s1", "cmd", [createTestStep("s1")])
    enterAwaitingResponse(state, { name: "string" })

    expect(state.awaitingResponse).toBe(true)
    expect(state.awaitingRetry).toBe(false)
    expect(state.pendingParse).toEqual({ name: "string" })
  })

  it("should work without parse config", () => {
    const state = createSessionState("s1", "cmd", [createTestStep("s1")])
    enterAwaitingResponse(state)

    expect(state.awaitingResponse).toBe(true)
    expect(state.pendingParse).toBeUndefined()
  })
})

describe("resetAwaitingState", () => {
  it("should reset all waiting states", () => {
    const state = createSessionState("s1", "cmd", [createTestStep("s1")])
    enterAwaitingResponse(state, { name: "string" })
    enterAwaitingRetry(state)

    resetAwaitingState(state)

    expect(state.awaitingResponse).toBe(false)
    expect(state.awaitingRetry).toBe(false)
    expect(state.pendingParse).toBeUndefined()
    expect(state.retries).toBe(3)
  })
})

describe("enterAwaitingRetry", () => {
  it("should set retry state and decrement retries", () => {
    const state = createSessionState("s1", "cmd", [createTestStep("s1")])
    expect(state.retries).toBe(3)

    enterAwaitingRetry(state)
    expect(state.awaitingRetry).toBe(true)
    expect(state.awaitingResponse).toBe(false)
    expect(state.retries).toBe(2)
  })
})

describe("hasRetries", () => {
  it("should return true when retries remain", () => {
    const state = createSessionState("s1", "cmd", [createTestStep("s1")])
    expect(hasRetries(state)).toBe(true)

    state.retries = 1
    expect(hasRetries(state)).toBe(true)
  })

  it("should return false when no retries", () => {
    const state = createSessionState("s1", "cmd", [createTestStep("s1")])
    state.retries = 0
    expect(hasRetries(state)).toBe(false)
  })
})

describe("buildRetryPrompt", () => {
  it("should build retry prompt with keys", () => {
    const prompt = buildRetryPrompt({ name: "string", age: "number" }, "JSON parse error")
    expect(prompt).toContain("name")
    expect(prompt).toContain("age")
    expect(prompt).toContain("JSON parse error")
  })
})

describe("buildStopPrompt", () => {
  it("should build stop prompt with step and metadata", () => {
    const step = createTestStep("test-step")
    step.prompt = "This is a test step with lots of content"

    const metadata = { name: "Alice", count: 5 }
    const prompt = buildStopPrompt(step, metadata)

    expect(prompt).toContain("Parse failed after 3 retries")
    // The prompt includes a truncated version of the prompt text
    expect(prompt).toContain("This is a test step")
    expect(prompt).toContain("Alice")
  })
})

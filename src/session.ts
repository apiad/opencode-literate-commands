/**
 * Session state management for literate commands
 */

import type { SessionState, Step, Metadata } from "./types.js"

/**
 * Create a new session state for a command
 */
export function createSessionState(
  sessionID: string,
  commandName: string,
  steps: Step[],
  args: string = ""
): SessionState {
  return {
    steps,
    currentStep: 0,
    metadata: { ARGUMENTS: args },
    sessionID,
    commandName,
    pendingParse: undefined,
    retries: 3,
    awaitingResponse: false,
    awaitingRetry: false,
  }
}

/**
 * Advance to the next step (sequential)
 */
export function advanceStep(state: SessionState): void {
  state.currentStep++
}

/**
 * Route to a specific step by name
 */
export function routeToStep(
  state: SessionState,
  stepName: string
): boolean {
  const index = state.steps.findIndex(
    (s) => s.config.step === stepName
  )
  if (index !== -1) {
    state.currentStep = index
    return true
  }
  return false
}

/**
 * Update metadata with new values
 */
export function updateMetadata(
  state: SessionState,
  data: Metadata
): void {
  Object.assign(state.metadata, data)
}

/**
 * Check if session is complete (no more steps)
 */
export function isSessionComplete(state: SessionState): boolean {
  return state.currentStep >= state.steps.length
}

/**
 * Get current step
 */
export function getCurrentStep(state: SessionState): Step | undefined {
  return state.steps[state.currentStep]
}

/**
 * Enter response waiting state
 */
export function enterAwaitingResponse(
  state: SessionState,
  parseConfig?: Record<string, "string" | "number" | "bool">
): void {
  state.awaitingResponse = true
  state.awaitingRetry = false
  state.pendingParse = parseConfig
}

/**
 * Enter retry waiting state
 */
export function enterAwaitingRetry(state: SessionState): void {
  state.awaitingRetry = true
  state.awaitingResponse = false
  state.retries--
}

/**
 * Reset waiting states after successful parse
 */
export function resetAwaitingState(state: SessionState): void {
  state.awaitingResponse = false
  state.awaitingRetry = false
  state.pendingParse = undefined
  state.retries = 3
}

/**
 * Check if session has retries remaining
 */
export function hasRetries(state: SessionState): boolean {
  return state.retries > 0
}

/**
 * Build retry prompt for parse failures
 */
export function buildRetryPrompt(
  parseConfig: Record<string, string>,
  error: string
): string {
  const keys = Object.keys(parseConfig).join(", ")
  return `Could not parse your response as valid JSON. Error: ${error}\n\nPlease respond with ONLY a JSON block containing the required keys. Format: {${keys}}.`
}

/**
 * Build stop prompt when retries exhausted
 */
export function buildStopPrompt(
  step: Step,
  metadata: Metadata
): string {
  return `Command stopped. Parse failed after 3 retries.\n\nCurrent step: "${step.prompt.slice(0, 100)}..."\nVariables so far: ${JSON.stringify(metadata)}\n\nPlease provide instructions.`
}

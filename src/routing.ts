/**
 * Step routing logic for literate commands
 */

import type { Metadata, Step } from "./types.js"

/**
 * Evaluate a condition string against metadata.
 *
 * Syntax:
 * - `"role === 'admin'"` → true if metadata.role === 'admin'
 * - `"age > 18"` → number comparison
 * - `"name.includes('John')"` → string methods
 * - `"isAdmin"` → boolean check
 *
 * @param condition - JavaScript-like condition expression
 * @param metadata - Variables to evaluate against
 * @returns Result of the condition evaluation
 */
export function evaluateCondition(
  condition: string,
  metadata: Metadata
): boolean {
  try {
    // Get all unique identifiers from the condition
    const identifierPattern = /[A-Za-z_$][A-Za-z0-9_$]*/g
    const identifiers = [...new Set(condition.match(identifierPattern) || [])]

    // Filter to only known variables (from metadata or JavaScript built-ins)
    const knownVars = identifiers.filter((id) => {
      if (["true", "false", "null", "undefined", "NaN", "Infinity"].includes(id))
        return false
      if (["typeof", "void", "delete", "in", "instanceof"].includes(id))
        return false
      return true
    })

    // Get values from metadata (undefined if not present)
    const values = knownVars.map((v) => metadata[v])

    // Create a function with all variables as parameters
    const fn = new Function(
      ...knownVars,
      `"use strict"; return (${condition});`
    )

    return fn(...values)
  } catch {
    return false
  }
}

/**
 * Find step index by its step name in config.
 *
 * @param steps - Array of steps to search
 * @param name - Step name to find
 * @returns Index of the step, or -1 if not found
 */
export function findStepByName(steps: Step[], name: string): number {
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].config.step === name) {
      return i
    }
  }
  return -1
}

/**
 * Resolve the next step index based on `next` config.
 *
 * Syntax:
 * - `next: step-name` → simple redirect
 * - `next:` → conditional map
 *   - `"condition": step` → evaluate condition, first match wins
 *   - `_:` step` → default fallback (only if no condition matched)
 *
 * @param next - Next configuration (string or conditional map)
 * @param steps - All steps in the command
 * @param metadata - Current variables
 * @returns Step index, or null to continue sequential
 */
export function resolveNextStep(
  next: string | Record<string, string> | undefined,
  steps: Step[],
  metadata: Metadata
): number | null {
  if (!next) {
    return null
  }

  // Simple string: next: step-name
  if (typeof next === "string") {
    const index = findStepByName(steps, next)
    if (index !== -1) {
      return index
    }
    return null
  }

  // Object: conditional map
  if (typeof next === "object") {
    let conditionMatched = false
    let defaultStep: string | null = null

    // Check each key in order
    for (const [key, value] of Object.entries(next)) {
      if (key === "_") {
        // Remember default fallback
        defaultStep = value
        continue
      }

      // Evaluate condition
      const evalResult = evaluateCondition(key, metadata)

      if (evalResult) {
        conditionMatched = true
        const index = findStepByName(steps, value)
        if (index !== -1) {
          return index
        }
        // Condition matched but target step not found
        break
      }
    }

    // If no condition matched, use default fallback
    if (!conditionMatched && defaultStep !== null) {
      const index = findStepByName(steps, defaultStep)
      if (index !== -1) {
        return index
      }
    }

    // No match found → continue sequential
    return null
  }

  return null
}

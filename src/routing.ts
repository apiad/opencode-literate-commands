/**
 * Step Routing Module
 * 
 * Handles routing logic based on `next` config.
 */

import type { Metadata, Step, StepConfig } from "../index.js"

// ============================================================================
// Public Functions
// ============================================================================

/**
 * Evaluate a condition string against metadata.
 * condition: "role === 'admin'" → true if metadata.role === 'admin'
 * Undefined variables in metadata are accessible as undefined.
 */
export function evaluateCondition(condition: string, metadata: Metadata): boolean {
    try {
        // Get all unique identifiers from the condition
        const identifierPattern = /[A-Za-z_$][A-Za-z0-9_$]*/g
        const identifiers = [...new Set(condition.match(identifierPattern) || [])]

        // Filter to only known variables (from metadata or JavaScript built-ins)
        const knownVars = identifiers.filter(id => {
            // Skip JavaScript keywords and built-ins
            if (['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'].includes(id)) return false
            if (['typeof', 'void', 'delete', 'in', 'instanceof'].includes(id)) return false
            return true
        })

        // Get values from metadata (undefined if not present)
        const values = knownVars.map(v => metadata[v])

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
 */
export function findStepByName(steps: Step[], name: string): number {
    for (let i = 0; i < steps.length; i++) {
        if (steps[i].config?.step === name) {
            return i
        }
    }
    return -1
}

/**
 * Resolve the next step index based on `next` config.
 *
 * Syntax:
 *   next: step-name           → simple redirect
 *   next:                     → conditional map
 *     condition: step          → evaluate condition, first match wins
 *     _: step                 → default fallback (only if no condition matched)
 *
 * Returns: step index, or null to continue sequential
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveNextStep(next: any, steps: Step[], metadata: Metadata): number | null {
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
                // Remember default fallback (but don't use yet)
                defaultStep = value as string
                continue
            }

            // Evaluate condition
            const evalResult = evaluateCondition(key, metadata)

            if (evalResult) {
                conditionMatched = true
                const index = findStepByName(steps, value as string)
                if (index !== -1) {
                    return index
                }
                // Condition matched but target is invalid → don't fall through to _
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

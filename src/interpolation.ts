/**
 * Variable Interpolation Module
 * 
 * Handles variable substitution in text and shell scripts.
 */

import type { Metadata } from "../index.js"

// ============================================================================
// Public Functions
// ============================================================================

/**
 * Get nested value from object using dot notation.
 */
export function getNestedValue(obj: unknown, path: string): unknown {
    return path.split(".").reduce((o: unknown, k: string) => (o as Record<string, unknown>)?.[k], obj)
}

/**
 * Interpolate variables in text using JSON.stringify.
 * $var → "value" (JSON-stringified)
 * $obj.nested → "nested value"
 * $arr.0 → first array element
 * $$ → full metadata as JSON string
 */
export function interpolate(text: string, metadata: Metadata): string {
    return text.replace(/\$(\$|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)/g, (match, path) => {
        if (path === "$") {
            return JSON.stringify(metadata)
        }
        const value = getNestedValue(metadata, path)
        return JSON.stringify(value ?? null)
    })
}

/**
 * Interpolate variables for shell scripts (no JSON-stringify).
 * $var → value (raw, suitable for shell)
 * $obj.nested → nested value
 * $arr.0 → first array element
 * $$ → full metadata as JSON string (for reference)
 *
 * This escapes values for shell safety.
 */
export function interpolateForShell(text: string, metadata: Metadata): string {
    return text.replace(/\$(\$|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)/g, (match, path) => {
        if (path === "$") {
            return JSON.stringify(metadata)
        }
        const value = getNestedValue(metadata, path)
        if (value === null || value === undefined) {
            return ""
        }
        if (typeof value === "string") {
            // Escape for shell - wrap in single quotes and escape any single quotes
            return `'${value.replace(/'/g, "'\\''")}'`
        }
        if (typeof value === "number" || typeof value === "boolean") {
            return String(value)
        }
        // For arrays and objects, convert to JSON
        return `'${JSON.stringify(value)}'`
    })
}

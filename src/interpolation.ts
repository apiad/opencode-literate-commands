/**
 * Variable substitution for literate commands
 */

import type { Metadata } from "./types.js"

/**
 * Get nested value from object using dot notation.
 * @example getNestedValue({ a: { b: { c: "deep" } } }, "a.b.c") => "deep"
 * @example getNestedValue({ arr: [1, 2, 3] }, "arr.0") => 1
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  return path.split(".").reduce((o, k) => {
    if (o === null || o === undefined) return undefined
    if (typeof o === "object" && o !== null && k in o) {
      return (o as Record<string, unknown>)[k]
    }
    return undefined
  }, obj)
}

/**
 * Interpolate variables in text using JSON.stringify.
 *
 * Syntax:
 * - `$var` → `"value"` (JSON-stringified)
 * - `$obj.nested` → `"nested value"`
 * - `$arr.0` → first array element
 * - `$$` → full metadata as JSON string
 *
 * @param text - Text containing variable references
 * @param metadata - Variables to substitute
 * @returns Text with variables replaced by JSON-stringified values
 */
export function interpolate(text: string, metadata: Metadata): string {
  return text.replace(
    /\$(\$|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)/g,
    (match, path) => {
      if (path === "$") {
        return JSON.stringify(metadata)
      }
      const value = getNestedValue(metadata, path)
      return JSON.stringify(value ?? null)
    }
  )
}

/**
 * Interpolate variables for shell scripts (no JSON-stringify).
 *
 * Syntax:
 * - `$var` → `value` (raw, suitable for shell)
 * - `$obj.nested` → nested value
 * - `$arr.0` → first array element
 * - `$$` → full metadata as JSON string
 *
 * Values are escaped for shell safety using single quotes.
 *
 * @param text - Text containing variable references
 * @param metadata - Variables to substitute
 * @returns Text with variables replaced by shell-safe values
 */
export function interpolateForShell(
  text: string,
  metadata: Metadata
): string {
  return text.replace(
    /\$(\$|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)/g,
    (match, path) => {
      if (path === "$") {
        return JSON.stringify(metadata)
      }
      const value = getNestedValue(metadata, path)
      if (value === null || value === undefined) {
        return ""
      }
      // Escape for shell: wrap in single quotes, escape any existing single quotes
      const str = String(value).replace(/'/g, "'\\''")
      return `'${str}'`
    }
  )
}

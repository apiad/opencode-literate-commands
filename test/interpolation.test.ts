/**
 * Interpolation tests
 */

import { describe, it, expect } from "vitest"
import { getNestedValue, interpolate, interpolateForShell } from "../src/interpolation.js"

describe("getNestedValue", () => {
  it("should get nested value", () => {
    const obj = { a: { b: { c: "deep" } } }
    expect(getNestedValue(obj, "a.b.c")).toBe("deep")
  })

  it("should get array element", () => {
    const obj = { arr: [1, 2, 3] }
    expect(getNestedValue(obj, "arr.0")).toBe(1)
    expect(getNestedValue(obj, "arr.1")).toBe(2)
  })

  it("should return undefined for missing path", () => {
    const obj = { a: 1 }
    expect(getNestedValue(obj, "b")).toBeUndefined()
  })

  it("should return undefined for null parent", () => {
    expect(getNestedValue(null, "a")).toBeUndefined()
  })
})

describe("interpolate", () => {
  it("should interpolate simple variable", () => {
    expect(interpolate("Hello $name", { name: "Alice" })).toBe('Hello "Alice"')
  })

  it("should interpolate number", () => {
    expect(interpolate("Count: $count", { count: 5 })).toBe("Count: 5")
  })

  it("should interpolate nested value", () => {
    expect(interpolate("User: $user.name", { user: { name: "Bob" } })).toBe('User: "Bob"')
  })

  it("should interpolate array element", () => {
    expect(interpolate("First: $items.0", { items: ["apple", "banana"] })).toBe('First: "apple"')
  })

  it("should handle $$ for full metadata", () => {
    const result = interpolate("$$", { name: "test" })
    expect(result).toContain('"name"')
    expect(result).toContain("test")
  })

  it("should handle missing variable as null", () => {
    expect(interpolate("Value: $missing", { other: "exists" })).toBe("Value: null")
  })

  it("should handle boolean true", () => {
    expect(interpolate("Enabled: $enabled", { enabled: true })).toBe("Enabled: true")
  })

  it("should handle boolean false", () => {
    expect(interpolate("Enabled: $enabled", { enabled: false })).toBe("Enabled: false")
  })

  it("should escape quotes in values", () => {
    expect(interpolate("$name", { name: 'Hello "World"' })).toBe('"Hello \\"World\\""')
  })

  it("should handle newlines", () => {
    expect(interpolate("$msg", { msg: "Line1\nLine2" })).toBe('"Line1\\nLine2"')
  })

  it("should handle multiple variables", () => {
    expect(interpolate("Hello $name, you have $count items", { name: "Bob", count: 3 })).toBe(
      'Hello "Bob", you have 3 items'
    )
  })

  it("should handle deep nesting", () => {
    const obj = { user: { profile: { name: "Alice" } }, items: [{ id: 1 }] }
    expect(interpolate("User: $user.profile.name", obj)).toBe('User: "Alice"')
    expect(interpolate("First: $items.0.id", obj)).toBe("First: 1")
  })
})

describe("interpolateForShell", () => {
  it("should interpolate without JSON stringify", () => {
    expect(interpolateForShell("Hello $name", { name: "Alice" })).toBe("Hello 'Alice'")
  })

  it("should escape single quotes", () => {
    expect(interpolateForShell("$name", { name: "O'Neil" })).toBe("'O'\\''Neil'")
  })

  it("should return empty for missing variable", () => {
    // Empty string for missing variables
    expect(interpolateForShell("Hello $missing", {})).toBe("Hello ")
  })

  it("should handle $$", () => {
    const result = interpolateForShell("$$", { key: "value" })
    expect(result).toContain("key")
    expect(result).toContain("value")
  })

  it("should be shell-safe", () => {
    const result = interpolateForShell("$cmd", { cmd: "rm -rf /" })
    expect(result).toBe("'rm -rf /'")
  })
})

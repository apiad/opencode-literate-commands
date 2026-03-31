/**
 * Interpolation tests
 */

import { describe, it, expect } from "vitest"
import {
    getNestedValue,
    interpolate,
    interpolateForShell,
} from "../index"

describe("getNestedValue", () => {
    it("should get deep nested value", () => {
        const obj = { a: { b: { c: "deep" } }, arr: [1, 2, 3] }
        expect(getNestedValue(obj, "a.b.c")).toBe("deep")
    })

    it("should get array element", () => {
        const obj = { a: { b: { c: "deep" } }, arr: [1, 2, 3] }
        expect(getNestedValue(obj, "arr.0")).toBe(1)
    })

    it("should return undefined for missing path", () => {
        const obj = { a: { b: { c: "deep" } }, arr: [1, 2, 3] }
        expect(getNestedValue(obj, "missing")).toBeUndefined()
    })
})

describe("interpolate", () => {
    it("should interpolate string variable", () => {
        expect(interpolate("Hello $name", { name: "Alice" })).toBe('Hello "Alice"')
    })

    it("should interpolate number variable", () => {
        expect(interpolate("Count: $count", { name: "Alice", count: 5 })).toBe("Count: 5")
    })

    it("should interpolate nested variable", () => {
        expect(interpolate("Nested: $nested.val", { nested: { val: "x" } })).toBe('Nested: "x"')
    })

    it("should include metadata for $$", () => {
        const result = interpolate("All: $$", { name: "Alice" })
        expect(result).toContain('"name":"Alice"')
    })

    it("should return null for missing variable", () => {
        expect(interpolate("Raw $missing", {})).toBe("Raw null")
    })

    it("should interpolate multiple variables", () => {
        expect(interpolate("Hello $name, you have $count items", { name: "Bob", count: 3 })).toBe('Hello "Bob", you have 3 items')
    })

    it("should handle escaped quotes", () => {
        expect(interpolate("$name", { name: 'Hello "World"' })).toBe('"Hello \\"World\\""')
    })

    it("should handle newlines", () => {
        expect(interpolate("$msg", { msg: "Line1\nLine2" })).toBe('"Line1\\nLine2"')
    })

    it("should interpolate boolean true", () => {
        expect(interpolate("Enabled: $enabled", { enabled: true })).toBe("Enabled: true")
    })

    it("should interpolate boolean false", () => {
        expect(interpolate("Enabled: $enabled", { enabled: false })).toBe("Enabled: false")
    })

    it("should handle undefined as null", () => {
        expect(interpolate("Value: $missing", { other: "exists" })).toBe("Value: null")
    })

    it("should handle deep nested access", () => {
        const nested = { user: { profile: { name: "Alice" } }, items: [{ id: 1 }, { id: 2 }] }
        expect(interpolate("User: $user.profile.name", nested)).toBe('User: "Alice"')
    })

    it("should handle array index access", () => {
        const nested = { user: { profile: { name: "Alice" } }, items: [{ id: 1 }, { id: 2 }] }
        expect(interpolate("First: $items.0.id", nested)).toBe("First: 1")
    })

    it("should handle $$ with multiple values", () => {
        const fullMeta = { a: 1, b: 2 }
        const result = interpolate("$$", fullMeta)
        expect(result).toContain('"a":1')
        expect(result).toContain('"b":2')
    })
})

describe("interpolateForShell", () => {
    it("should interpolate with single quotes for shell", () => {
        expect(interpolateForShell("Hello $name", { name: "Alice" })).toBe("Hello 'Alice'")
    })

    it("should escape single quotes in values", () => {
        expect(interpolateForShell("Hello $name", { name: "O'Brien" })).toBe("Hello 'O'\\''Brien'")
    })

    it("should return empty string for undefined", () => {
        expect(interpolateForShell("Hello $missing", {})).toBe("Hello ")
    })

    it("should handle nested values", () => {
        expect(interpolateForShell("Value: $obj.nested", { obj: { nested: "test" } })).toBe("Value: 'test'")
    })

    it("should handle $$ for full metadata", () => {
        const result = interpolateForShell("$$", { name: "Alice" })
        expect(result).toContain('"name":"Alice"')
    })
})

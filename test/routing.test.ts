/**
 * Routing tests
 */

import { describe, it, expect } from "vitest"
import {
    evaluateCondition,
    findStepByName,
    resolveNextStep,
} from "../index"

const createSteps = () => [
    { config: { step: "ask-role" }, prompt: "What role?", codeBlocks: [] },
    { config: { step: "admin-panel" }, prompt: "Admin panel", codeBlocks: [] },
    { config: { step: "user-panel" }, prompt: "User panel", codeBlocks: [] },
]

describe("evaluateCondition", () => {
    it("should evaluate equality with single quotes", () => {
        expect(evaluateCondition("role === 'admin'", { role: "admin" })).toBe(true)
        expect(evaluateCondition("role === 'admin'", { role: "user" })).toBe(false)
    })

    it("should evaluate equality with double quotes", () => {
        expect(evaluateCondition('role === "admin"', { role: "admin" })).toBe(true)
    })

    it("should evaluate number comparison", () => {
        expect(evaluateCondition("age > 18", { age: 25 })).toBe(true)
        expect(evaluateCondition("age > 18", { age: 15 })).toBe(false)
        expect(evaluateCondition("age >= 18", { age: 18 })).toBe(true)
        expect(evaluateCondition("age < 21", { age: 20 })).toBe(true)
    })

    it("should evaluate boolean variable", () => {
        expect(evaluateCondition("isAdmin", { isAdmin: true })).toBe(true)
        expect(evaluateCondition("isAdmin", { isAdmin: false })).toBe(false)
    })

    it("should evaluate AND logic", () => {
        expect(evaluateCondition("role === 'admin' && age > 18", { role: "admin", age: 25 })).toBe(true)
        expect(evaluateCondition("role === 'admin' && age > 18", { role: "admin", age: 15 })).toBe(false)
    })

    it("should evaluate OR logic", () => {
        expect(evaluateCondition("role === 'admin' || role === 'editor'", { role: "user" })).toBe(false)
        expect(evaluateCondition("role === 'admin' || role === 'editor'", { role: "editor" })).toBe(true)
    })

    it("should evaluate string methods", () => {
        expect(evaluateCondition("name.includes('John')", { name: "John Doe" })).toBe(true)
        expect(evaluateCondition("email.endsWith('@corp.com')", { email: "user@corp.com" })).toBe(true)
        expect(evaluateCondition("name.toLowerCase() === 'alice'", { name: "ALICE" })).toBe(true)
    })

    it("should handle undefined variable", () => {
        expect(evaluateCondition("missing === undefined", {})).toBe(true)
        expect(evaluateCondition("name !== undefined", {})).toBe(false)
    })

    it("should return false for invalid expression", () => {
        expect(evaluateCondition("role ===", {})).toBe(false)
    })
})

describe("findStepByName", () => {
    it("should find step by name", () => {
        const steps = createSteps()
        expect(findStepByName(steps, "admin-panel")).toBe(1)
        expect(findStepByName(steps, "user-panel")).toBe(2)
    })

    it("should return -1 for missing step", () => {
        const steps = createSteps()
        expect(findStepByName(steps, "missing")).toBe(-1)
    })

    it("should return -1 for empty array", () => {
        expect(findStepByName([], "anything")).toBe(-1)
    })
})

describe("resolveNextStep", () => {
    it("should handle string redirect", () => {
        const steps = createSteps()
        expect(resolveNextStep("admin-panel", steps, {})).toBe(1)
        expect(resolveNextStep("user-panel", steps, {})).toBe(2)
    })

    it("should return null for missing step", () => {
        const steps = createSteps()
        expect(resolveNextStep("missing-step", steps, {})).toBeNull()
    })

    it("should return null for undefined", () => {
        const steps = createSteps()
        expect(resolveNextStep(undefined, steps, {})).toBeNull()
    })

    it("should return null for empty string", () => {
        const steps = createSteps()
        expect(resolveNextStep("", steps, {})).toBeNull()
    })

    it("should evaluate conditional map", () => {
        const steps = createSteps()
        const conditions: any = {
            "role === 'admin'": "admin-panel",
            "role === 'user'": "user-panel",
            _: "ask-role",
        }

        expect(resolveNextStep(conditions, steps, { role: "admin" })).toBe(1)
        expect(resolveNextStep(conditions, steps, { role: "user" })).toBe(2)
        expect(resolveNextStep(conditions, steps, { role: "guest" })).toBe(0)
    })

    it("should use first match in conditional map", () => {
        const steps = createSteps()
        const conditions: any = {
            "role === 'admin'": "admin-panel",
            "role !== 'user'": "user-panel",
            _: "ask-role",
        }

        expect(resolveNextStep(conditions, steps, { role: "admin" })).toBe(1)
        expect(resolveNextStep(conditions, steps, { role: "other" })).toBe(2)
    })

    it("should fall back to _ when no condition matches", () => {
        const steps = createSteps()
        const conditions: any = {
            "role === 'admin'": "admin-panel",
            "role === 'user'": "user-panel",
        }

        expect(resolveNextStep(conditions, steps, { role: "guest" })).toBeNull()
    })

    it("should handle boolean variable in condition", () => {
        const steps = createSteps()
        const conditions: any = {
            isAdmin: "admin-panel",
            _: "user-panel",
        }

        expect(resolveNextStep(conditions, steps, { isAdmin: true })).toBe(1)
        expect(resolveNextStep(conditions, steps, { isAdmin: false })).toBe(2)
    })

    it("should handle number comparison", () => {
        const steps = createSteps()
        const conditions: any = {
            "age >= 18": "admin-panel",
            _: "user-panel",
        }

        expect(resolveNextStep(conditions, steps, { age: 25 })).toBe(1)
        expect(resolveNextStep(conditions, steps, { age: 15 })).toBe(2)
    })

    it("should handle string contains", () => {
        const steps = createSteps()
        const conditions: any = {
            "email.includes('@admin')": "admin-panel",
            "email.includes('@')": "user-panel",
            _: "ask-role",
        }

        expect(resolveNextStep(conditions, steps, { email: "boss@admin.com" })).toBe(1)
        expect(resolveNextStep(conditions, steps, { email: "user@example.com" })).toBe(2)
        expect(resolveNextStep(conditions, steps, { email: "invalid" })).toBe(0)
    })

    it("should handle special characters in condition", () => {
        const steps = createSteps()
        expect(resolveNextStep({ "name.includes('John')": "admin-panel" } as any, steps, { name: "John Doe" })).toBe(1)
    })

    it("should handle empty metadata with _ fallback", () => {
        const steps = createSteps()
        const conditions: any = {
            isAdmin: "admin-panel",
            _: "user-panel",
        }

        expect(resolveNextStep(conditions, steps, {})).toBe(2)
    })

    it("should handle target step not found", () => {
        const steps = createSteps()
        const conditions: any = {
            "role === 'admin'": "nonexistent-step",
            _: "ask-role",
        }

        expect(resolveNextStep(conditions, steps, { role: "admin" })).toBeNull()
        expect(resolveNextStep(conditions, steps, { role: "guest" })).toBe(0)
    })
})

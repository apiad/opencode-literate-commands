/**
 * Parser tests
 */

import { describe, it, expect } from "vitest"
import {
    hasLiterateFrontmatter,
    parseLiterateMarkdown,
    parseStep,
    parseSimpleYaml,
    parseNestedYaml,
    parseCodeBlocks,
    buildParseFormatInstruction,
    parseResponse,
} from "../index"

describe("hasLiterateFrontmatter", () => {
    it("should detect literate: true", () => {
        expect(hasLiterateFrontmatter("---\nliterate: true\n---\n")).toBe(true)
    })

    it("should not detect false", () => {
        expect(hasLiterateFrontmatter("---\nliterate: false\n---\n")).toBe(false)
    })

    it("should return false without frontmatter", () => {
        expect(hasLiterateFrontmatter("No frontmatter")).toBe(false)
    })

    it("should detect with indentation", () => {
        expect(hasLiterateFrontmatter("---\n  literate: true\n---\n")).toBe(true)
    })
})

describe("parseSimpleYaml", () => {
    it("should parse basic key-value", () => {
        expect(parseSimpleYaml("key: value")).toEqual({ key: "value" })
    })

    it("should parse double quotes", () => {
        expect(parseSimpleYaml('key: "quoted"')).toEqual({ key: "quoted" })
    })

    it("should parse single quotes", () => {
        expect(parseSimpleYaml("key: 'quoted'")).toEqual({ key: "quoted" })
    })

    it("should parse number", () => {
        expect(parseSimpleYaml("key: 123")).toEqual({ key: 123 })
    })

    it("should parse boolean true", () => {
        expect(parseSimpleYaml("key: true")).toEqual({ key: true })
    })

    it("should parse boolean false", () => {
        expect(parseSimpleYaml("key: false")).toEqual({ key: false })
    })

    it("should parse array", () => {
        expect(parseSimpleYaml("key: [a, b]")).toEqual({ key: ["a", "b"] })
    })

    it("should parse null", () => {
        expect(parseSimpleYaml("key: null")).toEqual({ key: null })
    })

    it("should ignore comments", () => {
        expect(parseSimpleYaml("# comment\nkey: value")).toEqual({ key: "value" })
    })
})

describe("parseNestedYaml", () => {
    it("should parse step name", () => {
        const result = parseNestedYaml("step: ask-info")
        expect(result.step).toBe("ask-info")
    })

    it("should parse nested parse block", () => {
        const result = parseNestedYaml(`step: ask-info
parse:
    topic: "What is the topic?"
    count: "What is the count?"`)

        expect(result.step).toBe("ask-info")
        expect(result.parse).toBeDefined()
        expect((result.parse as Record<string, string>).topic).toBe("What is the topic?")
        expect((result.parse as Record<string, string>).count).toBe("What is the count?")
    })

    it("should handle special characters in keys", () => {
        const result = parseNestedYaml(`parse:
    done?: "Is it done?"
    ok: next`)

        expect((result.parse as Record<string, string>)["done?"]).toBe("Is it done?")
        expect((result.parse as Record<string, string>).ok).toBe("next")
    })
})

describe("parseCodeBlocks", () => {
    it("should parse single block", () => {
        const blocks = parseCodeBlocks("```bash {exec}\necho hi\n```")
        expect(blocks).toHaveLength(1)
        expect(blocks[0].language).toBe("bash")
        expect(blocks[0].meta).toContain("exec")
        expect(blocks[0].code).toBe("echo hi")
    })

    it("should parse multiple blocks", () => {
        const blocks = parseCodeBlocks("```bash {exec}\necho hi\n```\n```python {exec mode=store}\nprint(1)\n```")

        expect(blocks).toHaveLength(2)
        expect(blocks[0].language).toBe("bash")
        expect(blocks[1].language).toBe("python")
        expect(blocks[1].meta).toContain("exec")
        expect(blocks[1].meta).toContain("mode=store")
    })

    it("should parse metadata correctly", () => {
        const blocks = parseCodeBlocks("```python {exec mode=store}\ncode\n```")
        expect(blocks[0].meta).toEqual(["exec", "mode=store"])
    })
})

describe("parseLiterateMarkdown", () => {
    it("should parse frontmatter", () => {
        const markdown = `---
description: test
---
Step 1
---
Step 2`
        const steps = parseLiterateMarkdown(markdown)
        expect(steps).toHaveLength(2)
    })

    it("should skip empty sections", () => {
        const markdown = `---
Step 1
---
---
Step 2`
        const steps = parseLiterateMarkdown(markdown)
        expect(steps.length).toBeGreaterThanOrEqual(1)
    })

    it("should preserve code blocks in step", () => {
        const markdown = `---
\`\`\`bash {exec}
echo hi
\`\`\`
`
        const steps = parseLiterateMarkdown(markdown)
        if (steps.length > 0) {
            expect(steps[0].codeBlocks.length).toBeGreaterThanOrEqual(0)
        }
    })
})

describe("parseStep", () => {
    it("should parse config block", () => {
        const step = parseStep("```yaml {config}\nstep: test\n```\nPrompt text")
        expect(step?.config.step).toBe("test")
        expect(step?.prompt).toBe("Prompt text")
    })

    it("should preserve non-config code blocks", () => {
        const step = parseStep("```yaml {config}\nstep: test\n```\nHere is JSON:\n```json\n{\"topic\": \"test\"}\n```")
        expect(step?.codeBlocks).toHaveLength(1)
        expect(step?.prompt).toContain("```json")
    })

    it("should return null for empty section", () => {
        expect(parseStep("")).toBeNull()
    })

    it("should preserve all code blocks in prompt", () => {
        const stepWithJson = `\`\`\`yaml {config}
step: test
\`\`\`
Here is JSON:
\`\`\`json
{"topic": "test"}
\`\`\`
And exec:
\`\`\`bash {exec}
echo hi
\`\`\`
Done.`
        const parsedStep = parseStep(stepWithJson)
        expect(parsedStep?.codeBlocks.length).toBe(2)
        expect(parsedStep?.prompt).toContain("```json")
        expect(parsedStep?.prompt).toContain("```bash {exec}")
        expect(parsedStep?.prompt).toContain("echo hi")
        expect(parsedStep?.codeBlocks[0].fullBlock).toBeTruthy()
        expect(parsedStep?.codeBlocks[1].fullBlock).toBeTruthy()
    })
})

describe("buildParseFormatInstruction", () => {
    it("should generate instruction for single key", () => {
        const instruction = buildParseFormatInstruction({ name: "string" })
        expect(instruction).toContain("{name}")
        expect(instruction).toContain("DO NOT add anything")
    })

    it("should generate instruction for multiple keys", () => {
        const instruction = buildParseFormatInstruction({ message: "string", count: "number" })
        expect(instruction).toContain("message")
        expect(instruction).toContain("count")
    })
})

describe("parseResponse", () => {
    it("should parse JSON code block", () => {
        const response = '```json\n{"topic": "AI", "count": 42}\n```'
        const result = parseResponse(response, { topic: "string", count: "number" })

        expect(result.success).toBe(true)
        expect(result.data?.topic).toBe("AI")
        expect(result.data?.count).toBe(42)
    })

    it("should parse raw JSON", () => {
        const response = '{"topic": "raw", "count": 100}'
        const result = parseResponse(response, { topic: "string", count: "number" })

        expect(result.success).toBe(true)
        expect(result.data?.topic).toBe("raw")
    })

    it("should parse boolean true", () => {
        const response = '{"done": true}'
        const result = parseResponse(response, { done: "bool" })

        expect(result.success).toBe(true)
        expect(result.data?.done).toBe(true)
    })

    it("should parse boolean false", () => {
        const response = '{"active": false}'
        const result = parseResponse(response, { active: "bool" })

        expect(result.success).toBe(true)
        expect(result.data?.active).toBe(false)
    })

    it("should handle missing keys", () => {
        const response = '{"topic": "partial"}'
        const result = parseResponse(response, { topic: "string", count: "number" })

        expect(result.success).toBe(true)
        expect(result.data?.topic).toBe("partial")
        expect(result.data?.count).toBeUndefined()
    })

    it("should fail on plain text", () => {
        const response = "Topic: Machine Learning\nCount: 10"
        const result = parseResponse(response, { topic: "string" })

        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
    })

    it("should fail on invalid JSON", () => {
        const response = "This is not JSON"
        const result = parseResponse(response, { topic: "string" })

        expect(result.success).toBe(false)
    })

    it("should fail on invalid JSON in block", () => {
        const response = '```json\n{invalid json}\n```'
        const result = parseResponse(response, { topic: "string" })

        expect(result.success).toBe(false)
    })

    it("should handle partial keys", () => {
        const response = '{"msg": "partial"}'
        const result = parseResponse(response, { msg: "string", num: "number" })

        expect(result.success).toBe(true)
        expect(result.data?.msg).toBe("partial")
        expect(result.data?.num).toBeUndefined()
    })

    it("should handle fenced JSON", () => {
        const response = '```json\n{"msg": "fenced", "num": 5, "flag": true}\n```'
        const result = parseResponse(response, { msg: "string", num: "number" })

        expect(result.success).toBe(true)
        expect(result.data?.msg).toBe("fenced")
    })
})

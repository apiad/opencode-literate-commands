/**
 * Executor tests
 */

import { describe, it, expect } from "vitest"
import {
    parseExecMeta,
    runScript,
    processScripts,
    parseStep,
} from "../index"

describe("parseExecMeta", () => {
    it("should default to python3 for python", () => {
        const result = parseExecMeta(["exec"], "python")
        expect(result.interpreter).toBe("python3")
    })

    it("should default to bash for bash", () => {
        const result = parseExecMeta(["exec"], "bash")
        expect(result.interpreter).toBe("bash")
    })

    it("should handle custom interpreter", () => {
        const result = parseExecMeta(["exec=uv", "run", "python"], "python")
        expect(result.interpreter).toBe("uv")
    })

    it("should handle mode=store", () => {
        const result = parseExecMeta(["exec", "mode=store"], "python")
        expect(result.mode).toBe("store")
    })

    it("should default to stdout mode", () => {
        const result = parseExecMeta(["exec"], "bash")
        expect(result.mode).toBe("stdout")
    })
})

describe("runScript", () => {
    it("should run bash echo", async () => {
        const result = await runScript(
            { language: "bash", code: 'echo "Hello World"', meta: ["exec"] },
            {},
            null
        )
        expect(result.output).toBe("Hello World")
    })

    it("should run python print", async () => {
        const result = await runScript(
            { language: "python", code: 'print("Python Hello")', meta: ["exec"] },
            {},
            null
        )
        expect(result.output).toBe("Python Hello")
    })

    it("should substitute variables with shell-safe quoting", async () => {
        const result = await runScript(
            { language: "bash", code: 'echo "Hello $name"', meta: ["exec"] },
            { name: "Alice" },
            null
        )
        expect(result.output).toBe("Hello 'Alice'")
    })

    it("should handle store mode", async () => {
        const result = await runScript(
            { language: "python", code: 'import json; print(json.dumps({"count": 5, "topic": "test"}))', meta: ["exec", "mode=store"] },
            {},
            null
        )
        expect(result.stored.count).toBe(5)
        expect(result.stored.topic).toBe("test")
        expect(result.output).toBe("")
    })

    it("should handle none mode", async () => {
        const result = await runScript(
            { language: "bash", code: 'echo "invisible"', meta: ["exec", "mode=none"] },
            {},
            null
        )
        expect(result.output).toBe("")
        expect(result.stored).toBeNull()
    })

    it("should handle errors", async () => {
        const result = await runScript(
            { language: "bash", code: "exit 1", meta: ["exec"] },
            {},
            null
        )
        expect(result.output).toContain("error")
    })
})

describe("processScripts", () => {
    it("should replace exec blocks with output", async () => {
        const testMarkdown = `\`\`\`yaml {config}
step: test
\`\`\`
Before
\`\`\`bash {exec}
echo ONE
\`\`\`
Middle
\`\`\`python {exec}
print('TWO')
\`\`\`
After`
        const parsedStep = parseStep(testMarkdown)
        const processedPrompt = await processScripts(parsedStep, {}, null)
        expect(processedPrompt).toContain("ONE")
        expect(processedPrompt).toContain("TWO")
        expect(processedPrompt).not.toContain("```bash")
        expect(processedPrompt).not.toContain("```python")
    })

    it("should preserve non-exec blocks", async () => {
        const stepWithJson = {
            prompt: "```json\n{\"key\": \"value\"}\n```\n```bash {exec}\necho done\n```",
            codeBlocks: [
                { language: "json", code: '{"key": "value"}', meta: [], fullBlock: "```json\n{\"key\": \"value\"}\n```" },
                { language: "bash", code: "echo done", meta: ["exec"], fullBlock: "```bash {exec}\necho done\n```" },
            ],
            config: {},
        }
        const processedJson = await processScripts(stepWithJson, {}, null)
        expect(processedJson).toContain("```json")
        expect(processedJson).toContain("done")
    })

    it("should update metadata from store mode", async () => {
        const metaStoreStep = {
            prompt: "```python {exec mode=store}\nimport json; print(json.dumps({\"count\": 10}))\n```",
            codeBlocks: [
                {
                    language: "python",
                    code: 'import json; print(json.dumps({"count": 10}))',
                    meta: ["exec", "mode=store"],
                    fullBlock: "```python {exec mode=store}\nimport json; print(json.dumps({\"count\": 10}))\n```",
                },
            ],
            config: {},
        }
        const testMeta: any = {}
        await processScripts(metaStoreStep, testMeta, null)
        expect(testMeta.count).toBe(10)
    })
})

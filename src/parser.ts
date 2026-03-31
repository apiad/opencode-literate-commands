/**
 * Markdown parsing for literate commands
 */

import type { CodeBlock, Step, Metadata } from "./types.js"

/**
 * Check if markdown content has `literate: true` in frontmatter
 */
export function hasLiterateFrontmatter(content: string): boolean {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return false
  const frontmatter = match[1]
  return /^\s*literate\s*:\s*true/m.test(frontmatter)
}

/**
 * Parse a complete literate command markdown into steps.
 * Steps are separated by `---` (with optional whitespace).
 */
export function parseLiterateMarkdown(content: string): Step[] {
  // Remove frontmatter
  let body = content
  if (body.startsWith("---")) {
    const endIndex = body.indexOf("\n---", 3)
    if (endIndex !== -1) {
      body = body.slice(endIndex + 4)
    }
  }

  // Split by --- separators (with optional leading/trailing whitespace)
  const sections = body.split(/\n---\n/)
  const steps: Step[] = []

  for (const section of sections) {
    const trimmed = section.trim()
    if (!trimmed) continue

    const step = parseStep(trimmed)
    if (step) {
      steps.push(step)
    }
  }

  return steps
}

/**
 * Parse a single step section into Step object.
 */
export function parseStep(section: string): Step | null {
  // Extract config block (```yaml {config}...```)
  const configMatch = section.match(/```yaml\s*\{config\}\n([\s\S]*?)```/)
  let config: Step["config"] = { step: `step-${Date.now()}` }
  let remaining = section

  if (configMatch) {
    const configText = configMatch[1]
    config = parseNestedYaml(configText)
    remaining = section.replace(configMatch[0], "").trim()
  }

  // Extract code blocks with their full text
  const codeBlocks = parseCodeBlocks(remaining)

  // Remove config block from prompt, keep everything else
  const prompt = remaining
    .replace(/```yaml\s*\{config\}\n[\s\S]*?```/g, "")
    .trim()

  if (!prompt && codeBlocks.length === 0) {
    return null
  }

  return { config, prompt, codeBlocks }
}

/**
 * Parse a simple YAML string into a flat key-value object.
 * Handles: key: value, key: "quoted", key: [a, b], key: true/false/null
 */
export function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = text.split("\n")

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const match = trimmed.match(/^(\w+)\s*:\s*(.*)$/)
    if (match) {
      const [, key, value] = match
      result[key] = parseYamlValue(value)
    }
  }

  return result
}

/**
 * Parse nested YAML config (handles parse:, question:, match: blocks).
 * Extracts top-level keys and nested content.
 */
export function parseNestedYaml(text: string): Step["config"] {
  const result: Record<string, unknown> = {}
  const lines = text.split("\n")
  let currentKey: string | null = null
  let currentNested: Record<string, unknown> | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    // Check for top-level key (no indent)
    const topMatch = trimmed.match(/^(\w+)\s*:\s*(.*)$/)
    if (topMatch && !line.startsWith(" ") && !line.startsWith("\t")) {
      currentKey = topMatch[1]
      const value = topMatch[2]

      if (value === "" || value === "~") {
        result[currentKey] = {}
        currentNested = result[currentKey] as Record<string, unknown>
      } else {
        result[currentKey] = parseYamlValue(value)
        currentNested = null
      }
    } else if (currentNested !== null) {
      // We're in a nested block - allow any characters in key
      const nestedMatch = trimmed.match(/^(.+?)\s*:\s*(.*)$/)
      if (nestedMatch) {
        const [, nestedKey, nestedValue] = nestedMatch
        ;(currentNested as Record<string, unknown>)[nestedKey] = parseYamlValue(nestedValue)
      }
    }
  }

  return result as Step["config"]
}

/**
 * Parse a YAML value into the appropriate type
 */
function parseYamlValue(value: string): unknown {
  const trimmed = value.trim()

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).split(",").map((s) => s.trim())
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (trimmed === "" || trimmed === "~" || trimmed === "null") return null
  if (!isNaN(Number(trimmed)) && trimmed !== "") return Number(trimmed)
  return trimmed
}

/**
 * Extract all code blocks with their metadata from text.
 */
export function parseCodeBlocks(section: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  const regex = /```(\w+)\s*\{([^}]+)\}\n([\s\S]*?)```/g
  let match

  while ((match = regex.exec(section)) !== null) {
    const language = match[1]
    const metaString = match[2]
    const code = match[3].trim()

    const meta = metaString.split(/\s+/).filter((m) => m)

    blocks.push({ language, meta, code, fullBlock: match[0] })
  }

  return blocks
}

/**
 * Build JSON format instruction from parse config.
 *
 * Input: { message: "string", count: "number" }
 * Output: instruction string to append to prompt
 */
export function buildParseFormatInstruction(
  parseConfig: Record<string, string>
): string {
  const keys = Object.keys(parseConfig).join(", ")
  return `\n\nFormat your response as JSON with the following keys: {${keys}}. DO NOT add anything before or after the JSON response, as it will be used for parsing.`
}

/**
 * Parse variables from model response based on type config.
 *
 * Response parsing priority:
 * 1. JSON code block (```json ... ```)
 * 2. Raw JSON (no fences)
 */
export function parseResponse(
  responseText: string,
  parseConfig: Record<string, string>
): { success: boolean; data?: Metadata; error?: string } {
  let jsonString: string | null = null

  // First, try to find JSON in code block
  const jsonBlockMatch = responseText.match(/```json\n([\s\S]*?)\n```/)
  if (jsonBlockMatch) {
    jsonString = jsonBlockMatch[1]
  } else {
    // Try to find raw JSON
    const trimmed = responseText.trim()
    if (trimmed.startsWith("{")) {
      jsonString = trimmed
    }
  }

  if (!jsonString) {
    return { success: false, error: "No valid JSON found in response" }
  }

  try {
    const parsed = JSON.parse(jsonString)
    const result: Metadata = {}

    for (const [key, type] of Object.entries(parseConfig)) {
      if (parsed[key] !== undefined) {
        switch (type) {
          case "bool":
            result[key] = Boolean(parsed[key])
            break
          case "number":
            result[key] = Number(parsed[key])
            break
          case "string":
          default:
            result[key] = String(parsed[key])
        }
      }
    }

    return { success: true, data: result }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Markdown Parser Module
 * 
 * Handles parsing of literate markdown into steps with code blocks.
 */

import type { CodeBlock, Step, StepConfig } from "../index.js"

// ============================================================================
// Public Functions
// ============================================================================

/**
 * Simple YAML check for literate: true in frontmatter.
 */
export function hasLiterateFrontmatter(content: string): boolean {
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return false
    const frontmatter = match[1]
    // Simple check for "literate: true" (not full YAML parsing)
    return /^\s*literate\s*:\s*true/m.test(frontmatter)
}

/**
 * Parse command markdown into steps.
 * Each step is separated by --- (with optional whitespace).
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
 * Parse a single step section.
 */
export function parseStep(section: string): Step | null {
    // Extract config block (```yaml {config}...```)
    const configMatch = section.match(/```yaml\s*\{config\}\n([\s\S]*?)```/)
    let config: StepConfig = { step: `step-${Date.now()}` }
    let remaining = section

    if (configMatch) {
        // Simple YAML parsing for config
        const configText = configMatch[1]
        config = parseNestedYaml(configText)
        remaining = section.replace(configMatch[0], "").trim()
    }

    // Extract code blocks with their full text (including delimiters)
    const codeBlocks: CodeBlock[] = []
    const blockRegex = /(```\w+\s*\{[^}]*\}\n[\s\S]*?```)/g
    let match

    while ((match = blockRegex.exec(remaining)) !== null) {
        const languageMatch = match[0].match(/^```(\w+)/)
        const metaMatch = match[0].match(/\{([^}]*)\}/)
        const codeMatch = match[0].match(/```\w+\s*\{[^}]*\}\n([\s\S]*?)```/)
        
        if (languageMatch && metaMatch && codeMatch) {
            codeBlocks.push({
                language: languageMatch[1],
                meta: metaMatch[1].split(/\s+/).filter(m => m),
                code: codeMatch[1],
                fullBlock: match[0]
            })
        }
    }

    // Remove config block from prompt, but keep everything else including other code blocks
    // The prompt retains all non-config code blocks as-is
    const prompt = remaining
        .replace(/```yaml\s*\{config\}\n[\s\S]*?```/g, "")
        .trim()

    if (!prompt && codeBlocks.length === 0) {
        return null
    }

    return { config, prompt, codeBlocks }
}

/**
 * Simple YAML parser for flat key-value pairs.
 */
export function parseSimpleYaml(text: string): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    const lines = text.split("\n")

    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue

        // Match "key: value" or "key: [items]"
        const match = trimmed.match(/^(\w+)\s*:\s*(.*)$/)
        if (match) {
            const [, key, value] = match

            // Try to parse the value
            if (value.startsWith("[") && value.endsWith("]")) {
                // Array
                result[key] = value.slice(1, -1).split(",").map((s) => s.trim())
            } else if (value.startsWith('"') && value.endsWith('"')) {
                // Double-quoted string
                result[key] = value.slice(1, -1)
            } else if (value.startsWith("'") && value.endsWith("'")) {
                // Single-quoted string
                result[key] = value.slice(1, -1)
            } else if (value === "true") {
                result[key] = true
            } else if (value === "false") {
                result[key] = false
            } else if (value === "" || value === "~" || value === "null") {
                result[key] = null
            } else if (!isNaN(Number(value)) && value.trim() !== "") {
                result[key] = Number(value)
            } else {
                result[key] = value.trim()
            }
        }
    }

    return result
}

/**
 * Parse nested YAML config (handles parse:, question:, match: blocks).
 * Extracts top-level keys and nested content.
 */
export function parseNestedYaml(text: string): StepConfig {
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
                // This key has nested content
                result[currentKey] = {}
                currentNested = result[currentKey] as Record<string, unknown>
            } else {
                // Simple value
                result[currentKey] = parseValue(value)
                currentNested = null
            }
        } else if (currentNested !== null) {
            // We're in a nested block
            // Allow any characters in the key (including spaces, quotes, operators like ===)
            const nestedMatch = trimmed.match(/^(.+?)\s*:\s*(.*)$/)
            if (nestedMatch) {
                const nestedKey = nestedMatch[1]
                const nestedValue = nestedMatch[2]
                currentNested[nestedKey] = parseValue(nestedValue)
            }
        }
    }

    return result as StepConfig
}

/**
 * Extract code blocks with their metadata.
 */
export function parseCodeBlocks(section: string): Array<{ language: string; meta: string[]; code: string }> {
    const blocks: Array<{ language: string; meta: string[]; code: string }> = []
    const regex = /```(\w+)\s*\{([^}]+)\}\n([\s\S]*?)```/g
    let match

    while ((match = regex.exec(section)) !== null) {
        const language = match[1]
        const metaString = match[2]
        const code = match[3].trim()

        // Parse metadata string into array
        const meta = metaString.split(/\s+/).filter(m => m)

        blocks.push({ language, meta, code })
    }

    return blocks
}

// ============================================================================
// Helper Functions
// ============================================================================

function parseValue(value: string): unknown {
    if (value.startsWith("[") && value.endsWith("]")) {
        return value.slice(1, -1).split(",").map((s) => s.trim())
    } else if (value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1)
    } else if (value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1)
    } else if (value === "true") {
        return true
    } else if (value === "false") {
        return false
    } else if (value === "" || value === "~" || value === "null") {
        return null
    } else if (!isNaN(Number(value)) && value.trim() !== "") {
        return Number(value)
    }
    return value.trim()
}

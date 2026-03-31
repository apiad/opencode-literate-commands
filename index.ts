/**
 * Literate Commands Plugin
 *
 * Enables step-by-step command execution from markdown.
 *
 * TESTING:
 *
 * Unit tests (parsing, interpolation):
 *   node .opencode/plugins/literate-commands.js
 *
 * Plugin integration (single command, no step advancement):
 *   opencode run --print-logs --log-level DEBUG --command test
 *
 *   Note: With `opencode run`, the session exits after the first idle,
 *   so only step 0 is injected. The acknowledgment works, and you can
 *   verify parsing, script execution, and variable interpolation from logs.
 *
 * Full step-through with SDK:
 *   // Start server, create session, run command, then prompt in a loop
 *   // See SDK docs: https://opencode.ai/docs/sdk
 *
 * Manual full test:
 *   opencode serve --print-logs --log-level DEBUG &
 *   opencode run --print-logs --log-level DEBUG --command test --attach http://localhost:PORT
 */

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"

const COMMANDS_DIR = ".opencode/commands"

// State per session
const sessionStates = new Map()

async function log(client, msg) {
    // console.error("INFO [literate-commands]", msg)
}

// Simple YAML check for literate: true
export function hasLiterateFrontmatter(content: string): boolean {
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return false
    const frontmatter = match[1]
    // Simple check for "literate: true" (not full YAML parsing)
    return /^\s*literate\s*:\s*true/m.test(frontmatter)
}

// ============================================================================
// Markdown Parsing
// ============================================================================

/**
 * Parse command markdown into steps.
 * Each step is separated by --- (with optional whitespace).
 */
export function parseLiterateMarkdown(content: string): any[] {
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
    const steps = []

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
export function parseStep(section: string): any {
    // Extract config block (```yaml {config}...```)
    const configMatch = section.match(/```yaml\s*\{config\}\n([\s\S]*?)```/)
    let config = { step: `step-${Date.now()}` }
    let remaining = section

    if (configMatch) {
        // Simple YAML parsing for config
        const configText = configMatch[1]
        config = parseNestedYaml(configText)
        remaining = section.replace(configMatch[0], "").trim()
    }

    // Extract code blocks with their full text (including delimiters)
    const codeBlocks = []
    const blockRegex = /(```\w+\s*\{[^}]*\}\n[\s\S]*?```)/g
    let lastIndex = 0
    let match

    while ((match = blockRegex.exec(remaining)) !== null) {
        codeBlocks.push({
            language: match[0].match(/^```(\w+)/)[1],
            meta: match[0].match(/\{([^}]*)\}/)[1].split(/\s+/).filter(m => m),
            code: match[0].match(/```\w+\s*\{[^}]*\}\n([\s\S]*?)```/)[1],
            fullBlock: match[0]  // Preserve exact string for later replacement
        })
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
 * Simple YAML parser for nested key-value pairs.
 * Handles: key: value, nested.key: value, key: "quoted value", key: [a, b, c]
 */
export function parseSimpleYaml(text: string): any {
    const result = {}
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
                result[key] = value.slice(1, -1).split(",").map(s => s.trim())
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
            } else if (!isNaN(value) && value.trim() !== "") {
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
export function parseNestedYaml(text: string): any {
    const result = {}
    const lines = text.split("\n")
    let currentKey = null
    let currentNested = null
    let indentLevel = 0

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
                currentNested = result[currentKey]
                indentLevel = 0
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
                const [nestedKey, nestedValue] = nestedMatch.slice(1)
                currentNested[nestedKey] = parseValue(nestedValue)
            }
        }
    }

    return result
}

function parseValue(value) {
    if (value.startsWith("[") && value.endsWith("]")) {
        return value.slice(1, -1).split(",").map(s => s.trim())
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
    } else if (!isNaN(value) && value.trim() !== "") {
        return Number(value)
    }
    return value.trim()
}

/**
 * Extract code blocks with their metadata.
 */
export function parseCodeBlocks(section: string): any[] {
    const blocks = []
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
// Variable Substitution
// ============================================================================

/**
 * Get nested value from object using dot notation.
 */
export function getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((o, k) => o?.[k], obj)
}

/**
 * Extract text from the latest assistant message in a session.
 * Returns the combined text from all text parts of the assistant's response.
 */
async function getLatestAssistantResponse(client, sessionID) {
    try {
        const response = await client.session.messages({ path: { id: sessionID } })
        const messages = response.data

        // Find the latest assistant message (messages are ordered by time)
        // The latest message should be the last one with role "assistant"
        let latestAssistant = null
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i]
            if (msg.info?.role === "assistant") {
                latestAssistant = msg
                break
            }
        }

        if (!latestAssistant) {
            return null
        }

        // Parts are already embedded in the message - no separate API call needed
        const texts = []
        for (const part of latestAssistant.parts) {
            if (part.type === "text") {
                texts.push(part.text)
            }
        }

        return texts.join("\n")
    } catch (e) {
        console.error("[literate-commands] Error fetching messages:", e.message)
        return null
    }
}

/**
 * Interpolate variables in text using JSON.stringify.
 * $var → "value" (JSON-stringified)
 * $obj.nested → "nested value"
 * $arr.0 → first array element
 * $$ → full metadata as JSON string
 */
export function interpolate(text: string, metadata: any): string {
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
export function interpolateForShell(text: string, metadata: any): string {
    return text.replace(/\$(\$|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)/g, (match, path) => {
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
    })
}

// ============================================================================
// Script Execution
// ============================================================================

const INTERPRETERS = {
    python: "python3",
    python3: "python3",
    bash: "bash",
    sh: "sh",
    javascript: "node",
    js: "node"
}

const DEFAULT_TIMEOUT = 30000

/**
 * Parse exec block metadata.
 * {exec} → { interpreter: based on language, mode: 'stdout' }
 * {exec=python3} → { interpreter: 'python3', mode: 'stdout' }
 * {exec mode=store} → { interpreter: based on language, mode: 'store' }
 */
export function parseExecMeta(meta: string[], language: string): { interpreter: string; mode: string } {
    // Default interpreter based on language
    let interpreter = INTERPRETERS[language] || language
    let mode = "stdout"

    for (const item of meta) {
        if (item.startsWith("exec=")) {
            interpreter = item.replace("exec=", "")
        } else if (item.startsWith("mode=")) {
            mode = item.replace("mode=", "")
        }
        // "exec" without = is a marker, ignore it
    }

    return { interpreter, mode }
}

/**
 * Execute a script with variable substitution.
 */
export async function runScript(block: any, metadata: any, $: any): Promise<{ output: string; stored: any }> {
    const { language, code, meta } = block
    const { interpreter: interp, mode } = parseExecMeta(meta, language)

    // Get actual interpreter command
    const cmd = INTERPRETERS[interp] || interp

    // Substitute variables in code (shell-safe for bash/sh, regular for others)
    let substitutedCode
    if (cmd === "bash" || cmd === "sh") {
        substitutedCode = interpolateForShell(code, metadata)
    } else {
        // For Python, Node, etc. - use regular interpolation with JSON-stringify
        substitutedCode = interpolate(code, metadata)
    }

    // Build execution command
    let execCmd
    if (cmd === "bash" || cmd === "sh") {
        execCmd = `${cmd} -c '${substitutedCode.replace(/'/g, "'\\''")}'`
    } else if (cmd === "python3" || cmd === "python") {
        execCmd = `${cmd} -c '${substitutedCode.replace(/'/g, "'\\''")}'`
    } else if (cmd === "node") {
        execCmd = `${cmd} -e '${substitutedCode.replace(/'/g, "'\\''")}'`
    } else {
        execCmd = `${cmd} -c '${substitutedCode.replace(/'/g, "'\\''")}'`
    }

    await log(null, `[literate-commands] Running script`)

    // Execute via docker or locally
    const useDocker = process.env.LITERATE_DOCKER === "true"
    let fullCmd

    if (useDocker) {
        const image = process.env.LITERATE_DOCKER_IMAGE || "python:3.11"
        fullCmd = `docker run --rm ${image} ${execCmd}`
    } else {
        fullCmd = execCmd
    }

    try {
        // Use execSync for reliable execution
        const output = execSync(fullCmd, { encoding: "utf8" }).trim()

        if (mode === "stdout") {
            return { output, stored: null }
        } else if (mode === "store") {
            try {
                const parsed = JSON.parse(output)
                if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                    await log(null, `[literate-commands] Store mode requires object, got ${typeof parsed}`)
                    return { output: "", stored: null }
                }
                return { output: "", stored: parsed }
            } catch (e) {
                await log(null, `[literate-commands] JSON parse failed: ${output}`)
                return { output: "", stored: null }
            }
        } else {
            // mode === "none"
            return { output: "", stored: null }
        }
    } catch (e) {
        await log(null, `[literate-commands] Script error: ${e.message}`)
        return { output: `Script error: ${e.message}`, stored: null }
    }
}

/**
 * Process all {exec} blocks in a step.
 */
export async function processScripts(step: any, metadata: any, $: any): Promise<string> {
    let resultPrompt = step.prompt

    for (const block of step.codeBlocks) {
        if (!block.meta.includes("exec")) continue

        const { output, stored } = await runScript(block, metadata, $)

        // Update metadata if store mode
        if (stored) {
            Object.assign(metadata, stored)
        }

        // Replace EXACT block string with output (for stdout mode)
        if (output) {
            resultPrompt = resultPrompt.replace(block.fullBlock, output)
        } else {
            // Remove block if no output (stdout is empty)
            resultPrompt = resultPrompt.replace(block.fullBlock, "")
        }
    }

    return resultPrompt
}

// ============================================================================
// Parse Functionality
// ============================================================================

/**
 * Build JSON format instruction from parse config keys.
 *
 * Input: { message: "string", count: "number", active: "bool" }
 * Output: "\n\nFormat your response as JSON with the following keys: {message, count, active}. DO NOT add anything before or after the JSON response, as it will be used for parsing."
 */
export function buildParseFormatInstruction(parseConfig: any): string {
    const keys = Object.keys(parseConfig).join(", ")
    return `\n\nFormat your response as JSON with the following keys: {${keys}}. DO NOT add anything before or after the JSON response, as it will be used for parsing.`
}

/**
 * Parse variables from model response based on type-based config.
 *
 * Config format (NEW):
 *   parse:
 *     message: string    # string type
 *     count: number       # number type
 *     active: bool        # boolean type
 *
 * Returns: { success: true, data: { key: value, ... } }
 *      or: { success: false, error: "error message" }
 *
 * Response parsing priority:
 * 1. JSON code block (```json ... ```)
 * 2. Raw JSON (no fences)
 */
export function parseResponse(responseText: string, parseConfig: any): { success: boolean; data?: any; error?: string } {
    let jsonString = null

    // First, try to find JSON in code block
    const jsonBlockMatch = responseText.match(/```json\n([\s\S]*?)\n```/)
    if (jsonBlockMatch) {
        jsonString = jsonBlockMatch[1]
    } else {
        // Try to find raw JSON (might be the whole response)
        const trimmed = responseText.trim()
        if (trimmed.startsWith("{")) {
            // Might be raw JSON, use the whole thing
            jsonString = trimmed
        }
    }

    if (jsonString) {
        try {
            const parsed = JSON.parse(jsonString)
            const result = {}

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
            return { success: false, error: e.message }
        }
    }

    // No valid JSON found
    return { success: false, error: "No valid JSON found in response" }
}

/**
 * Process parse config from step and extract variables.
 * Called after model responds.
 *
 * Returns: { success: boolean, data?: object, error?: string }
 */
export function processParse(step: any, responseText: string, metadata: any, client: any): any {
    if (!step.config.parse) {
        return { success: true, data: metadata }
    }

    const result = parseResponse(responseText, step.config.parse)

    if (result.success) {
        log(client, `[literate-commands] Parsed variables: ${JSON.stringify(result.data)}`)
        // Merge parsed data into metadata
        Object.assign(metadata, result.data)
        return { success: true, data: metadata }
    } else {
        log(client, `[literate-commands] Parse failed: ${result.error}`)
        return { success: false, error: result.error }
    }
}

// ============================================================================
// Step Routing (next config)
// ============================================================================

/**
 * Evaluate a condition string against metadata.
 * condition: "role === 'admin'" → true if metadata.role === 'admin'
 * Undefined variables in metadata are accessible as undefined.
 */
export function evaluateCondition(condition: string, metadata: any): boolean {
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
    } catch (e) {
        log(null, `[literate-commands] Condition eval error: ${e.message}`)
        return false
    }
}

/**
 * Find step index by its step name in config.
 */
export function findStepByName(steps: any[], name: string): number {
    for (let i = 0; i < steps.length; i++) {
        if (steps[i].config.step === name) {
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
export function resolveNextStep(next: any, steps: any[], metadata: any): number | null {
    if (!next) {
        return null
    }

    // Simple string: next: step-name
    if (typeof next === "string") {
        const index = findStepByName(steps, next)
        if (index !== -1) {
            return index
        }
        log(null, `[literate-commands] next: "${next}" not found, continuing sequential`)
        return null
    }

    // Object: conditional map
    if (typeof next === "object") {
        let conditionMatched = false
        let defaultStep = null

        log(null, `[literate-commands] resolveNextStep: next config = ${JSON.stringify(next)}, metadata = ${JSON.stringify(metadata)}`)

        // Check each key in order
        for (const [key, value] of Object.entries(next)) {
            log(null, `[literate-commands] Checking key: "${key}" = "${value}"`)

            if (key === "_") {
                // Remember default fallback (but don't use yet)
                defaultStep = value
                log(null, `[literate-commands] Found default fallback: "${value}"`)
                continue
            }

            // Evaluate condition
            const evalResult = evaluateCondition(key, metadata)
            log(null, `[literate-commands] evaluateCondition("${key}", ...) = ${evalResult}`)

            if (evalResult) {
                conditionMatched = true
                const index = findStepByName(steps, value)
                if (index !== -1) {
                    log(null, `[literate-commands] Condition matched! Routing to step ${index}`)
                    return index
                }
                log(null, `[literate-commands] next condition "${key}" matched but step "${value}" not found`)
                // Don't fall through to _ - this condition explicitly matched but target is invalid
                break
            }
        }

        // If no condition matched, use default fallback
        if (!conditionMatched && defaultStep !== null) {
            log(null, `[literate-commands] No condition matched, using default fallback: "${defaultStep}"`)
            const index = findStepByName(steps, defaultStep)
            if (index !== -1) {
                return index
            }
            log(null, `[literate-commands] next _: "${defaultStep}" not found, continuing sequential`)
        }

        // No match found → continue sequential
        log(null, `[literate-commands] No route match, continuing sequential`)
        return null
    }

    return null
}

export default async function literateCommandsPlugin({ client, $ }) {
    await log(client, "[literate-commands] Plugin initialized")

    return {
        "command.execute.before": async (input, output) => {
            const { command, sessionID, arguments: args } = input

            await log(client, `[literate-commands] Intercepting /${command}`)

            // Load command markdown
            const commandPath = join(COMMANDS_DIR, `${command}.md`)

            if (!existsSync(commandPath)) {
                await log(client, `[literate-commands] Command not found: ${commandPath}`)
                return // Let normal execution handle it
            }

            const content = readFileSync(commandPath, "utf-8")

            // Check for literate: true in frontmatter
            const isLiterate = hasLiterateFrontmatter(content)

            if (!isLiterate) {
                await log(client, `[literate-commands] /${command} is not literate, skipping`)
                return // Let normal execution handle it
            }

            await log(client, `[literate-commands] /${command} is literate, setting up state`)

            // Parse markdown into steps
            const steps = parseLiterateMarkdown(content)
            await log(client, `[literate-commands] Parsed ${steps.length} steps`)

            // Log each step for debugging
            await log(client, `[literate-commands] Parsed ${steps.length} steps:`)
            for (let i = 0; i < steps.length; i++) {
                await log(client, `[literate-commands]   Step ${i}: "${steps[i].prompt.slice(0, 50)}..."`)
            }

            // Set up state for this session
            sessionStates.set(sessionID, {
                steps,
                currentStep: 0,
                metadata: { ARGUMENTS: args || "" },
                sessionID,
                commandName: command,
                pendingParse: null,      // parse config waiting for response
                retries: 3,             // retry count (default 3)
                awaitingResponse: false,  // waiting for first response after prompt
                awaitingRetry: false     // waiting for retry response after retry prompt
            })
            await log(client, `[literate-commands] State set for session ${sessionID}`)

            // Inject acknowledgment
            output.parts.length = 1;
            output.parts[0] = {
                type: "text",
                text: `We are preparing to run the /${command} command.\nI will give you more instructions.\nPlease acknowledge and await.`
            };
        },

        event: async ({ event }) => {
            if (event.type !== "session.idle") return

            const sessionID = event.properties?.sessionID
            if (!sessionID) return

            const state = sessionStates.get(sessionID)
            if (!state) {
                await log(client, `[literate-commands] No state for session ${sessionID}`)
                return
            }

            await log(client, `[literate-commands] session.idle for ${sessionID}, step ${state.currentStep}, awaitingResponse=${state.awaitingResponse}, awaitingRetry=${state.awaitingRetry}`)

            // Get current step
            const stepIndex = state.currentStep
            const step = state.steps[stepIndex]
            if (!step) {
                await log(client, `[literate-commands] No more steps, done`)
                sessionStates.delete(sessionID)
                return
            }

            // =====================================================
            // Handle waiting states (parse response, then inject NEXT step)
            // =====================================================
            if (state.awaitingRetry || state.awaitingResponse) {
                const responseText = await getLatestAssistantResponse(client, sessionID)
                await log(client, `[literate-commands] Got response: ${responseText?.slice(0, 100) || "null"}...`)

                if (!responseText) {
                    await log(client, `[literate-commands] No response yet, waiting...`)
                    return
                }

                const parseResult = processParse(step, responseText, state.metadata, client)

                if (parseResult.success) {
                    // Parse succeeded!
                    state.awaitingRetry = false
                    state.awaitingResponse = false
                    state.pendingParse = null
                    state.retries = 3
                    await log(client, `[literate-commands] Parse succeeded, metadata: ${JSON.stringify(state.metadata)}`)

                    // Check for `next` routing on CURRENT step
                    const routedIndex = resolveNextStep(step.config.next, state.steps, state.metadata)
                    if (routedIndex !== null) {
                        await log(client, `[literate-commands] Routing to step ${routedIndex} via next config`)
                        state.currentStep = routedIndex
                    } else {
                        // No routing, advance sequentially
                        state.currentStep++
                        await log(client, `[literate-commands] Advancing to step ${state.currentStep}`)
                    }

                    // Get NEXT step and inject it
                    const nextStepIndex = state.currentStep
                    const nextStep = state.steps[nextStepIndex]
                    if (!nextStep) {
                        await log(client, `[literate-commands] No more steps, done`)
                        sessionStates.delete(sessionID)
                        return
                    }

                    await log(client, `[literate-commands] Processing step ${nextStepIndex}: "${nextStep.prompt.slice(0, 50)}..."`)

                    const processedPrompt = await processScripts(nextStep, state.metadata, $)
                    let finalPrompt = interpolate(processedPrompt, state.metadata)

                    if (nextStep.config.parse) {
                        const formatInstruction = buildParseFormatInstruction(nextStep.config.parse)
                        finalPrompt = finalPrompt + formatInstruction
                        state.pendingParse = nextStep.config.parse
                        state.awaitingResponse = true
                        await log(client, `[literate-commands] Added parse instruction, awaiting response`)
                    }

                    await log(client, `[literate-commands] Injecting: ${finalPrompt.slice(0, 100)}...`)
                    await client.session.promptAsync({
                        path: { id: sessionID },
                        body: { parts: [{ type: "text", text: finalPrompt }] }
                    })

                    // If no parse config on next step, advance after injection
                    // (routing will be handled when that step's response is parsed)
                    if (!nextStep.config.parse) {
                        // Check if next step itself has `next` for immediate routing
                        const nextRoutedIndex = resolveNextStep(nextStep.config.next, state.steps, state.metadata)
                        if (nextRoutedIndex !== null) {
                            state.currentStep = nextRoutedIndex
                        } else {
                            state.currentStep++
                        }
                    }
                    return
                } else {
                    // Parse failed - start retry cycle
                    state.retries--
                    state.awaitingRetry = true
                    state.awaitingResponse = false
                    await log(client, `[literate-commands] Parse failed (${state.retries} retries left): ${parseResult.error}`)

                    if (state.retries > 0) {
                        const retryPrompt = `Could not parse your response as valid JSON. Error: ${parseResult.error}\n\nPlease respond with ONLY a JSON block containing the required keys. Format: {${Object.keys(state.pendingParse || step.config.parse || {}).join(", ")}}.`
                        await client.session.promptAsync({
                            path: { id: sessionID },
                            body: { parts: [{ type: "text", text: retryPrompt }] }
                        })
                    } else {
                        const stopPrompt = `Command stopped. Parse failed after 3 retries at step ${stepIndex}.\n\nCurrent step: "${step.prompt.slice(0, 100)}..."\nVariables so far: ${JSON.stringify(state.metadata)}\n\nPlease provide instructions.`
                        await client.session.promptAsync({
                            path: { id: sessionID },
                            body: { parts: [{ type: "text", text: stopPrompt }] }
                        })
                        sessionStates.delete(sessionID)
                    }
                    return
                }
            }

            // =====================================================
            // Fresh step - process and inject
            // =====================================================
            await log(client, `[literate-commands] Processing step ${stepIndex}: "${step.prompt.slice(0, 50)}..."`)

            // Process scripts and interpolate
            const processedPrompt = await processScripts(step, state.metadata, $)
            let finalPrompt = interpolate(processedPrompt, state.metadata)

            // If this step has parse config, add JSON format instruction
            if (step.config.parse) {
                const formatInstruction = buildParseFormatInstruction(step.config.parse)
                finalPrompt = finalPrompt + formatInstruction
                state.pendingParse = step.config.parse
                state.awaitingResponse = true
                await log(client, `[literate-commands] Added parse instruction, awaiting response`)
            }

            await log(client, `[literate-commands] Injecting: ${finalPrompt.slice(0, 100)}...`)

            await client.session.promptAsync({
                path: { id: sessionID },
                body: { parts: [{ type: "text", text: finalPrompt }] }
            })

            // Check for stop: true - end the command
            if (step.config.stop === true) {
                await log(client, `[literate-commands] Stop requested, ending command`)
                sessionStates.delete(sessionID)
                return
            }

            // If no parse config, check for routing
            if (!step.config.parse) {
                const routedIndex = resolveNextStep(step.config.next, state.steps, state.metadata)
                if (routedIndex !== null) {
                    await log(client, `[literate-commands] Routing to step ${routedIndex} via next config`)
                    state.currentStep = routedIndex
                } else {
                    await log(client, `[literate-commands] Advancing to step ${stepIndex + 1}`)
                    state.currentStep++
                }
            }
        }
    }
}


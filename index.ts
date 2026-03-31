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

// ============================================================================
// Types
// ============================================================================

export interface CodeBlock {
    language: string
    meta: string[]
    code: string
    fullBlock: string
}

export interface Step {
    config: StepConfig
    prompt: string
    codeBlocks: CodeBlock[]
}

export interface StepConfig {
    step?: string
    parse?: Record<string, string>
    next?: string | Record<string, string>
    stop?: boolean
}

export interface Metadata {
    [key: string]: unknown
}

export interface SessionState {
    steps: Step[]
    currentStep: number
    metadata: Metadata
    sessionID: string
    commandName: string
    pendingParse: Record<string, string> | null
    retries: number
    awaitingResponse: boolean
    awaitingRetry: boolean
}

export interface ParseResult {
    success: boolean
    data?: Metadata
    error?: string
}

export interface ExecResult {
    output: string
    stored: Metadata | null
}

// ============================================================================
// Constants
// ============================================================================

const COMMANDS_DIR = ".opencode/commands"

// State per session
const sessionStates = new Map<string, SessionState>()

async function log(_client: unknown, _msg: string): Promise<void> {
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
 * Simple YAML parser for nested key-value pairs.
 * Handles: key: value, nested.key: value, key: "quoted value", key: [a, b, c]
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
                result[key] = value.slice(1, -1).split(",").map((s: string) => s.trim())
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

function parseValue(value: string): unknown {
    if (value.startsWith("[") && value.endsWith("]")) {
        return value.slice(1, -1).split(",").map((s: string) => s.trim())
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

import { getNestedValue, interpolate, interpolateForShell } from "./src/interpolation.js"

// Re-export for backwards compatibility and internal use
export { getNestedValue, interpolate, interpolateForShell }

/**
 * Extract text from the latest assistant message in a session.
 * Returns the combined text from all text parts of the assistant's response.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLatestAssistantResponse(client: any, sessionID: string): Promise<string | null> {
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
        const texts: string[] = []
        for (const part of latestAssistant.parts || []) {
            if (part.type === "text" && part.text) {
                texts.push(part.text)
            }
        }

        return texts.join("\n")
    } catch (e) {
        console.error("[literate-commands] Error fetching messages:", (e as Error).message)
        return null
    }
}

// ============================================================================
// Script Execution
// ============================================================================

import { runScript, processScripts, parseExecMeta } from "./src/executor.js"
export { runScript, processScripts, parseExecMeta }

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
            const result: Record<string, unknown> = {}

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

import { evaluateCondition, findStepByName, resolveNextStep } from "./src/routing.js"
export { evaluateCondition, findStepByName, resolveNextStep }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function literateCommandsPlugin({ client, $ }: { client: any; $: any }) {
    await log(client, "[literate-commands] Plugin initialized")

    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "command.execute.before": async (input: any, output: any) => {
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        event: async ({ event }: { event: any }) => {
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


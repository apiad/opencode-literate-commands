/**
 * Literate Commands Plugin
 *
 * Enables step-by-step command execution from markdown.
 *
 * TESTING:
 *
 * Unit tests (parsing, interpolation):
 *   npm test
 *
 * Plugin integration:
 *   opencode run --print-logs --log-level DEBUG --command test
 */

import { readFileSync, existsSync } from "fs"
import { join } from "path"

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
    agent?: string
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
// Re-exports
// ============================================================================

// Parser
export { 
    hasLiterateFrontmatter, 
    parseLiterateMarkdown, 
    parseStep, 
    parseSimpleYaml, 
    parseNestedYaml, 
    parseCodeBlocks 
} from "./src/parser.js"

// Interpolation
export { getNestedValue, interpolate, interpolateForShell } from "./src/interpolation.js"

// Executor
export { runScript, processScripts, parseExecMeta } from "./src/executor.js"

// Parse
export { buildParseFormatInstruction, parseResponse, processParse } from "./src/parse.js"

// Routing
export { evaluateCondition, findStepByName, resolveNextStep } from "./src/routing.js"

// Plugin
export { default } from "./src/plugin.js"


/**
 * Script Execution Module
 * 
 * Handles script execution with variable substitution.
 */

import { execSync } from "child_process"
import type { Metadata } from "../index.js"
import { interpolate, interpolateForShell } from "./interpolation.js"

// ============================================================================
// Constants
// ============================================================================

const INTERPRETERS: Record<string, string> = {
    python: "python3",
    python3: "python3",
    bash: "bash",
    sh: "sh",
    node: "node",
    bun: "bun",
    deno: "deno",
    ruby: "ruby",
    perl: "perl",
    php: "php",
}

// ============================================================================
// Types
// ============================================================================

interface CodeBlock {
    language: string
    meta: string[]
    code: string
    fullBlock?: string
}

interface RunScriptResult {
    output: string
    stored: Metadata | null
}

// ============================================================================
// Public Functions
// ============================================================================

/**
 * Parse exec block metadata.
 * {exec} → { interpreter: based on language, mode: 'stdout' }
 * {exec=python3} → { interpreter: 'python3', mode: 'stdout' }
 * {exec mode=store} → { interpreter: based on language, mode: 'store' }
 */
export function parseExecMeta(meta: string[], language: string): { interpreter: string; mode: string } {
    // Default interpreter based on language
    let interpreter = INTERPRETERS[language] || language || "bash"
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
export async function runScript(
    block: CodeBlock,
    metadata: Metadata,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $: any
): Promise<RunScriptResult> {
    const { language, code, meta } = block
    const { interpreter: interp, mode } = parseExecMeta(meta, language)

    // Get actual interpreter command
    const cmd = INTERPRETERS[interp] || interp

    // Substitute variables in code (shell-safe for bash/sh, regular for others)
    let substitutedCode: string
    if (cmd === "bash" || cmd === "sh") {
        substitutedCode = interpolateForShell(code, metadata)
    } else {
        // For Python, Node, etc. - use regular interpolation with JSON-stringify
        substitutedCode = interpolate(code, metadata)
    }

    // Build execution command
    let execCmd: string
    if (cmd === "bash" || cmd === "sh") {
        execCmd = `${cmd} -c '${substitutedCode.replace(/'/g, "'\\''")}'`
    } else if (cmd === "python3" || cmd === "python") {
        execCmd = `${cmd} -c '${substitutedCode.replace(/'/g, "'\\''")}'`
    } else if (cmd === "node") {
        execCmd = `${cmd} -e '${substitutedCode.replace(/'/g, "'\\''")}'`
    } else {
        execCmd = `${cmd} -c '${substitutedCode.replace(/'/g, "'\\''")}'`
    }

    // Execute via docker or locally
    const useDocker = process.env.LITERATE_DOCKER === "true"
    let fullCmd: string

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
                    return { output: "", stored: null }
                }
                return { output: "", stored: parsed as Metadata }
            } catch {
                return { output: "", stored: null }
            }
        } else {
            // mode === "none"
            return { output: "", stored: null }
        }
    } catch (e) {
        return { output: `Script error: ${(e as Error).message}`, stored: null }
    }
}

/**
 * Process all {exec} blocks in a step.
 */
export async function processScripts(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    step: any,
    metadata: Metadata,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $: any
): Promise<string> {
    let resultPrompt = step.prompt

    for (const block of step.codeBlocks) {
        if (!block.meta.includes("exec")) continue

        const { output, stored } = await runScript(block, metadata, $)

        // Update metadata if store mode
        if (stored) {
            Object.assign(metadata, stored)
        }

        // Replace EXACT block string with output (for stdout mode)
        const blockStr = block.fullBlock || `\`\`\`${block.language}\n${block.code}\n\`\`\``
        if (output) {
            resultPrompt = resultPrompt.replace(blockStr, output)
        } else {
            // Remove block if no output (stdout is empty)
            resultPrompt = resultPrompt.replace(blockStr, "")
        }
    }

    return resultPrompt
}

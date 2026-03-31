/**
 * Script execution for literate commands
 */

import { execSync } from "child_process"
import type { CodeBlock, ExecResult, Metadata, LiterateCommandsOptions } from "./types.js"
import { INTERPRETERS } from "./types.js"
import { interpolate, interpolateForShell } from "./interpolation.js"

/**
 * Parse exec block metadata.
 *
 * Syntax:
 * - `{exec}` → default interpreter based on language, stdout mode
 * - `{exec=python3}` → custom interpreter
 * - `{exec mode=store}` → capture JSON output
 */
export function parseExecMeta(
  meta: string[],
  language: string
): { interpreter: string; mode: "stdout" | "store" | "none" } {
  let interpreter = INTERPRETERS[language] || language
  let mode: "stdout" | "store" | "none" = "stdout"

  for (const item of meta) {
    if (item.startsWith("exec=")) {
      interpreter = item.replace("exec=", "")
    } else if (item.startsWith("mode=")) {
      const modeValue = item.replace("mode=", "")
      if (modeValue === "stdout" || modeValue === "store" || modeValue === "none") {
        mode = modeValue
      }
    }
  }

  return { interpreter, mode }
}

/**
 * Execute a script block with variable substitution.
 *
 * @param block - Code block to execute
 * @param metadata - Variables for substitution
 * @param options - Plugin configuration
 * @returns Execution result with output and stored variables
 */
export async function runScript(
  block: CodeBlock,
  metadata: Metadata,
  options: LiterateCommandsOptions
): Promise<ExecResult> {
  const { language, code, meta } = block
  const { interpreter: interp, mode } = parseExecMeta(meta, language)

  // Get actual interpreter command
  const cmd = INTERPRETERS[interp] || interp

  // Substitute variables in code (shell-safe for bash/sh, regular for others)
  let substitutedCode: string
  if (cmd === "bash" || cmd === "sh") {
    substitutedCode = interpolateForShell(code, metadata)
  } else {
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
  let fullCmd: string
  if (options.dockerEnabled) {
    const image = options.dockerImage || "python:3.11"
    fullCmd = `docker run --rm ${image} ${execCmd}`
  } else {
    fullCmd = execCmd
  }

  try {
    const output = execSync(fullCmd, {
      encoding: "utf8",
      timeout: options.defaultTimeout,
    }).trim()

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
    const error = e as Error & { message?: string }
    return { output: `Script error: ${error.message}`, stored: null }
  }
}

/**
 * Process all {exec} blocks in a step.
 *
 * @param prompt - Step prompt containing code blocks
 * @param codeBlocks - Extracted code blocks
 * @param metadata - Variables for substitution and storage
 * @param options - Plugin configuration
 * @returns Prompt with exec blocks replaced by output
 */
export async function processScripts(
  prompt: string,
  codeBlocks: CodeBlock[],
  metadata: Metadata,
  options: LiterateCommandsOptions
): Promise<string> {
  let resultPrompt = prompt

  for (const block of codeBlocks) {
    if (!block.meta.includes("exec")) continue

    const { output, stored } = await runScript(block, metadata, options)

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

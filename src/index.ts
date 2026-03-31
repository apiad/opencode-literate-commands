/**
 * Literate Commands Plugin for OpenCode
 *
 * Enables step-by-step command execution from markdown files.
 */

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import type { PluginInput, Hooks } from "@opencode-ai/plugin"
import { hasLiterateFrontmatter, parseLiterateMarkdown } from "./parser.js"

// State per session - using any to avoid complex type issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionStates = new Map<string, any>()

const COMMANDS_DIR = ".opencode/commands"

// ============================================================================
// Core Functions (from JS version)
// ============================================================================

/**
 * Get nested value from object using dot notation.
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce((o: unknown, k) => (o as Record<string, unknown>)?.[k], obj)
}

/**
 * Extract text from the latest assistant message in a session.
 */
async function getLatestAssistantResponse(
  client: PluginInput["client"],
  sessionID: string
): Promise<string | null> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = (response as unknown as { data: Array<{ info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> }> }).data

    if (!messages || !Array.isArray(messages)) {
      return null
    }

    // Find the latest assistant message
    let latestAssistant: typeof messages[number] | null = null
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

    // Combine all text parts
    const texts: string[] = []
    for (const part of latestAssistant.parts || []) {
      if (part.type === "text" && part.text) {
        texts.push(part.text)
      }
    }

    return texts.join("\n")
  } catch {
    return null
  }
}

/**
 * Interpolate variables in text using JSON.stringify.
 */
function interpolate(text: string, metadata: Record<string, unknown>): string {
  return text.replace(/\$(\$|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)/g, (match, path) => {
    if (path === "$") {
      return JSON.stringify(metadata)
    }
    const value = getNestedValue(metadata, path)
    return JSON.stringify(value ?? null)
  })
}

/**
 * Process all {exec} blocks in a step.
 */
async function processScriptsStep(
  step: { prompt: string; codeBlocks: Array<{ language: string; meta: string[]; code: string; fullBlock: string }> },
  metadata: Record<string, unknown>
): Promise<string> {
  let resultPrompt = step.prompt

  for (const block of step.codeBlocks) {
    if (!block.meta.includes("exec")) continue

    // Import exec logic inline (simplified)
    const { execSync } = await import("child_process")

    const INTERPRETERS: Record<string, string> = {
      python: "python3",
      python3: "python3",
      bash: "bash",
      sh: "sh",
      javascript: "node",
      js: "node",
    }

    const cmd = INTERPRETERS[block.language] || block.language

    // Interpolate for shell
    const interpolated = interpolate(
      block.code,
      metadata
    ).replace(/^"|"$/g, "'").replace(/\\"/g, '"')

    let output = ""
    try {
      if (cmd === "bash" || cmd === "sh") {
        output = execSync(`${cmd} -c '${interpolated}'`, { encoding: "utf8" }).trim()
      } else if (cmd === "python3" || cmd === "python") {
        output = execSync(`${cmd} -c '${interpolated}'`, { encoding: "utf8" }).trim()
      } else if (cmd === "node") {
        output = execSync(`${cmd} -e '${interpolated}'`, { encoding: "utf8" }).trim()
      } else {
        output = execSync(`${cmd} -c '${interpolated}'`, { encoding: "utf8" }).trim()
      }
    } catch (e: unknown) {
      output = `Script error: ${(e as Error).message}`
    }

    if (output) {
      resultPrompt = resultPrompt.replace(block.fullBlock, output)
    } else {
      resultPrompt = resultPrompt.replace(block.fullBlock, "")
    }
  }

  return resultPrompt
}

/**
 * Build JSON format instruction from parse config keys.
 */
function buildParseFormatInstruction(parseConfig: Record<string, string>): string {
  const keys = Object.keys(parseConfig).join(", ")
  return `\n\nFormat your response as JSON with the following keys: {${keys}}. DO NOT add anything before or after the JSON response, as it will be used for parsing.`
}

/**
 * Parse variables from model response based on type-based config.
 */
function parseResponse(responseText: string, parseConfig: Record<string, string>): { success: boolean; data?: Record<string, unknown>; error?: string } {
  let jsonString: string | null = null

  // First, try to find JSON in code block
  const jsonBlockMatch = responseText.match(/```json\n([\s\S]*?)\n```/)
  if (jsonBlockMatch) {
    jsonString = jsonBlockMatch[1]
  } else {
    const trimmed = responseText.trim()
    if (trimmed.startsWith("{")) {
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
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  }

  return { success: false, error: "No valid JSON found in response" }
}

/**
 * Evaluate a condition string against metadata.
 */
function evaluateCondition(condition: string, metadata: Record<string, unknown>): boolean {
  try {
    const identifierPattern = /[A-Za-z_$][A-Za-z0-9_$]*/g
    const identifiers = [...new Set(condition.match(identifierPattern) || [])]

    const knownVars = identifiers.filter(id => {
      if (['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'].includes(id)) return false
      if (['typeof', 'void', 'delete', 'in', 'instanceof'].includes(id)) return false
      return true
    })

    const values = knownVars.map(v => metadata[v])

    const fn = new Function(
      ...knownVars,
      `"use strict"; return (${condition});`
    )

    return fn(...values)
  } catch {
    return false
  }
}

/**
 * Find step index by its step name.
 */
function findStepByName(steps: Array<{ config: Record<string, unknown> }>, name: string): number {
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].config.step === name) {
      return i
    }
  }
  return -1
}

/**
 * Resolve the next step index based on `next` config.
 */
function resolveNextStep(
  next: string | Record<string, string> | undefined,
  steps: Array<{ config: Record<string, unknown> }>,
  metadata: Record<string, unknown>
): number | null {
  if (!next) return null

  // Simple string: next: step-name
  if (typeof next === "string") {
    const index = findStepByName(steps, next)
    if (index !== -1) return index
    return null
  }

  // Object: conditional map
  if (typeof next === "object") {
    let conditionMatched = false
    let defaultStep: string | null = null

    for (const [key, value] of Object.entries(next)) {
      if (key === "_") {
        defaultStep = value
        continue
      }

      const evalResult = evaluateCondition(key, metadata)
      if (evalResult) {
        conditionMatched = true
        const index = findStepByName(steps, value)
        if (index !== -1) return index
      }
    }

    if (!conditionMatched && defaultStep !== null) {
      const index = findStepByName(steps, defaultStep)
      if (index !== -1) return index
    }

    return null
  }

  return null
}

// ============================================================================
// Plugin Export (matching JS pattern exactly)
// ============================================================================

export default async function({ client }: PluginInput): Promise<Hooks> {
  return {
    "command.execute.before": async (input, output) => {
      const { command, sessionID, arguments: args } = input

      // Load command markdown
      const commandPath = join(COMMANDS_DIR, `${command}.md`)

      if (!existsSync(commandPath)) {
        return // Let normal execution handle it
      }

      const content = readFileSync(commandPath, "utf-8")

      // Check for literate: true in frontmatter
      const isLiterate = hasLiterateFrontmatter(content)

      if (!isLiterate) {
        return // Let normal execution handle it
      }

      // Parse markdown into steps
      const steps = parseLiterateMarkdown(content)

      // Set up state for this session
      sessionStates.set(sessionID, {
        steps,
        currentStep: 0,
        metadata: { ARGUMENTS: args || "" },
        sessionID,
        commandName: command,
        pendingParse: null,
        retries: 3,
        awaitingResponse: false,
        awaitingRetry: false,
      })

      // Inject acknowledgment
      ;(output.parts as Array<{ type: string; text: string }>).length = 1
      ;(output.parts as Array<{ type: string; text: string }>)[0] = {
        type: "text",
        text: `We are preparing to run the /${command} command.\nI will give you more instructions.\nPlease acknowledge and await.`,
      }
    },

    event: async ({ event }) => {
      if (event.type !== "session.idle") return

      const sessionID = event.properties?.sessionID
      if (!sessionID) return

      const state = sessionStates.get(sessionID)
      if (!state) return

      // Get current step
      const stepIndex = state.currentStep
      const step = state.steps[stepIndex]
      if (!step) {
        sessionStates.delete(sessionID)
        return
      }

      // =====================================================
      // Handle waiting states (parse response, then inject NEXT step)
      // =====================================================
      if (state.awaitingRetry || state.awaitingResponse) {
        const responseText = await getLatestAssistantResponse(client, sessionID)

        if (!responseText) return

        const parseResult = parseResponse(responseText, state.pendingParse || step.config.parse as Record<string, string> || {})

        if (parseResult.success) {
          // Parse succeeded!
          state.awaitingRetry = false
          state.awaitingResponse = false
          state.pendingParse = null
          state.retries = 3
          Object.assign(state.metadata, parseResult.data || {})

          // Check for `next` routing on CURRENT step
          const routedIndex = resolveNextStep(step.config.next as string | Record<string, string>, state.steps, state.metadata)
          if (routedIndex !== null) {
            state.currentStep = routedIndex
          } else {
            state.currentStep++
          }

          // Get NEXT step and inject it
          const nextStepIndex = state.currentStep
          const nextStep = state.steps[nextStepIndex]
          if (!nextStep) {
            sessionStates.delete(sessionID)
            return
          }

          const processedPrompt = await processScriptsStep(nextStep, state.metadata)
          let finalPrompt = interpolate(processedPrompt, state.metadata)

          if (nextStep.config.parse) {
            const formatInstruction = buildParseFormatInstruction(nextStep.config.parse as Record<string, string>)
            finalPrompt = finalPrompt + formatInstruction
            state.pendingParse = nextStep.config.parse as Record<string, string>
            state.awaitingResponse = true
          }

          await client.session.promptAsync({
            path: { id: sessionID },
            body: { parts: [{ type: "text", text: finalPrompt }] },
          })

          // If no parse config on next step, advance after injection
          if (!nextStep.config.parse) {
            const nextRoutedIndex = resolveNextStep(nextStep.config.next as string | Record<string, string>, state.steps, state.metadata)
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

          if (state.retries > 0) {
            const retryPrompt = `Could not parse your response as valid JSON. Error: ${parseResult.error}\n\nPlease respond with ONLY a JSON block containing the required keys. Format: {${Object.keys(state.pendingParse || step.config.parse || {}).join(", ")}}.`
            await client.session.promptAsync({
              path: { id: sessionID },
              body: { parts: [{ type: "text", text: retryPrompt }] },
            })
          } else {
            const stopPrompt = `Command stopped. Parse failed after 3 retries at step ${stepIndex}.\n\nCurrent step: "${step.prompt.slice(0, 100)}..."\nVariables so far: ${JSON.stringify(state.metadata)}\n\nPlease provide instructions.`
            await client.session.promptAsync({
              path: { id: sessionID },
              body: { parts: [{ type: "text", text: stopPrompt }] },
            })
            sessionStates.delete(sessionID)
          }
          return
        }
      }

      // =====================================================
      // Fresh step - process and inject
      // =====================================================
      const processedPrompt = await processScriptsStep(step, state.metadata)
      let finalPrompt = interpolate(processedPrompt, state.metadata)

      // If this step has parse config, add JSON format instruction
      if (step.config.parse) {
        const formatInstruction = buildParseFormatInstruction(step.config.parse as Record<string, string>)
        finalPrompt = finalPrompt + formatInstruction
        state.pendingParse = step.config.parse as Record<string, string>
        state.awaitingResponse = true
      }

      await client.session.promptAsync({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: finalPrompt }] },
      })

      // Check for stop: true - end the command
      if (step.config.stop === true) {
        sessionStates.delete(sessionID)
        return
      }

      // If no parse config, check for routing
      if (!step.config.parse) {
        const routedIndex = resolveNextStep(step.config.next as string | Record<string, string>, state.steps, state.metadata)
        if (routedIndex !== null) {
          state.currentStep = routedIndex
        } else {
          state.currentStep++
        }
      }
    },
  }
}

/**
 * Literate Commands Plugin for OpenCode
 *
 * Enables step-by-step command execution from markdown files.
 */

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin"
import type {
  LiterateCommandsOptions,
  SessionState,
  Metadata,
  Step,
} from "./types.js"
import { DEFAULT_OPTIONS } from "./types.js"
import {
  hasLiterateFrontmatter,
  parseLiterateMarkdown,
  buildParseFormatInstruction,
  parseResponse,
} from "./parser.js"
import { interpolate } from "./interpolation.js"
import { processScripts } from "./executor.js"
import { resolveNextStep } from "./routing.js"
import {
  createSessionState,
  advanceStep,
  getCurrentStep,
  enterAwaitingResponse,
  resetAwaitingState,
  enterAwaitingRetry,
  hasRetries,
  buildRetryPrompt,
  buildStopPrompt,
} from "./session.js"

// State per session
const sessionStates = new Map<string, SessionState>()

/**
 * Extract text from the latest assistant message in a session.
 */
async function getLatestAssistantResponse(
  client: PluginInput["client"],
  sessionID: string
): Promise<string | null> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = response.data

    if (!messages || !Array.isArray(messages)) {
      return null
    }

    // Find the latest assistant message
    // Messages are in info property according to SDK structure
    let latestAssistant: typeof messages[number] | null = null
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if ((msg as unknown as { info?: { role?: string } }).info?.role === "assistant") {
        latestAssistant = msg
        break
      }
    }

    if (!latestAssistant) {
      return null
    }

    // Combine all text parts - parts is in the message object
    const msgObj = latestAssistant as unknown as { parts?: Array<{ type?: string; text?: string }> }
    const texts: string[] = []
    for (const part of msgObj.parts || []) {
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
 * Inject a prompt into the session
 */
async function injectPrompt(
  client: PluginInput["client"],
  sessionID: string,
  prompt: string
): Promise<void> {
  await client.session.promptAsync({
    path: { id: sessionID },
    body: { parts: [{ type: "text", text: prompt }] },
  })
}

/**
 * Process a step: execute scripts, interpolate variables, prepare prompt
 */
async function processStep(
  step: Step,
  metadata: Metadata,
  options: LiterateCommandsOptions
): Promise<{ prompt: string; waiting: boolean }> {
  // Process scripts and interpolate
  const processedPrompt = await processScripts(
    step.prompt,
    step.codeBlocks,
    metadata,
    options
  )
  let finalPrompt = interpolate(processedPrompt, metadata)

  // Check for stop
  if (step.config.stop === true) {
    return { prompt: finalPrompt, waiting: false }
  }

  // If step has parse config, add JSON format instruction
  if (step.config.parse) {
    const formatInstruction = buildParseFormatInstruction(step.config.parse)
    finalPrompt = finalPrompt + formatInstruction
    return { prompt: finalPrompt, waiting: true }
  }

  return { prompt: finalPrompt, waiting: false }
}

/**
 * Handle session idle event with state
 */
async function handleSessionIdle(
  state: SessionState,
  client: PluginInput["client"],
  config: Required<LiterateCommandsOptions>
): Promise<void> {
  const sessionID = state.sessionID

  const step = getCurrentStep(state)
  if (!step) {
    sessionStates.delete(sessionID)
    return
  }

  // Handle waiting states (parse response, then inject NEXT step)
  if (state.awaitingRetry || state.awaitingResponse) {
    const responseText = await getLatestAssistantResponse(client, sessionID)

    if (!responseText) return

    const parseConfig = state.pendingParse || step.config.parse
    if (!parseConfig) {
      resetAwaitingState(state)
      return
    }

    const parseResult = parseResponse(responseText, parseConfig)

    if (parseResult.success) {
      // Parse succeeded!
      resetAwaitingState(state)
      Object.assign(state.metadata, parseResult.data || {})

      // Check for routing on CURRENT step
      const routedIndex = resolveNextStep(
        step.config.next,
        state.steps,
        state.metadata
      )
      if (routedIndex !== null) {
        state.currentStep = routedIndex
      } else {
        advanceStep(state)
      }

      // Get NEXT step and process it
      const nextStep = getCurrentStep(state)
      if (!nextStep) {
        sessionStates.delete(sessionID)
        return
      }

      const { prompt, waiting } = await processStep(nextStep, state.metadata, config)

      await injectPrompt(client, sessionID, prompt)

      if (waiting) {
        enterAwaitingResponse(state, nextStep.config.parse)
      } else if (nextStep.config.parse) {
        enterAwaitingResponse(state, nextStep.config.parse)
      }

      return
    } else {
      // Parse failed - start retry cycle
      enterAwaitingRetry(state)

      if (hasRetries(state)) {
        const retryPrompt = buildRetryPrompt(
          parseConfig,
          parseResult.error || "Unknown error"
        )
        await injectPrompt(client, sessionID, retryPrompt)
      } else {
        const stopPrompt = buildStopPrompt(step, state.metadata)
        await injectPrompt(client, sessionID, stopPrompt)
        sessionStates.delete(sessionID)
      }
      return
    }
  }

  // Fresh step - process and inject
  const { prompt, waiting } = await processStep(step, state.metadata, config)

  await injectPrompt(client, sessionID, prompt)

  // Check for stop
  if (step.config.stop === true) {
    sessionStates.delete(sessionID)
    return
  }

  // If no parse config, check for routing
  if (!step.config.parse) {
    const routedIndex = resolveNextStep(
      step.config.next,
      state.steps,
      state.metadata
    )
    if (routedIndex !== null) {
      state.currentStep = routedIndex
    } else {
      advanceStep(state)
    }
  } else {
    enterAwaitingResponse(state, step.config.parse)
  }
}

/**
 * Create the Literate Commands plugin
 */
export function LiterateCommands(
  options: LiterateCommandsOptions = {}
): Plugin {
  return async (input: PluginInput): Promise<Hooks> => {
    const config = { ...DEFAULT_OPTIONS, ...options }

    return {
      "command.execute.before": async (hookInput, output) => {
        const { command, sessionID, arguments: args } = hookInput

        // Load command markdown
        const commandPath = join(config.commandsDir, `${command}.md`)

        if (!existsSync(commandPath)) {
          return // Let normal execution handle it
        }

        const content = readFileSync(commandPath, "utf-8")

        // Check for literate: true in frontmatter
        if (!hasLiterateFrontmatter(content)) {
          return // Let normal execution handle it
        }

        // Parse markdown into steps
        const steps = parseLiterateMarkdown(content)

        // Set up state for this session
        const state = createSessionState(sessionID, command, steps, args || "")
        sessionStates.set(sessionID, state)

        // Inject acknowledgment - clear existing parts and add our message
        output.parts.length = 0
        // @ts-expect-error - OpenCode internal part structure
        output.parts.push({
          type: "text",
          text: `We are preparing to run the /${command} command.\nI will give you more instructions.\nPlease acknowledge and await.`,
        })
      },

      event: async (hookInput) => {
        const event = hookInput.event

        if (event.type !== "session.idle") return

        const sessionID = (event as { properties?: { sessionID?: string } }).properties?.sessionID
        if (!sessionID) return

        const state = sessionStates.get(sessionID)
        if (!state) return

        await handleSessionIdle(state, input.client, config)
      },
    }
  }
}

export default LiterateCommands

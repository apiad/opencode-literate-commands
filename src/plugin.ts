/**
 * Plugin Module
 * 
 * Main plugin entry point and session management.
 */

import { readFileSync, existsSync } from "fs"
import { join } from "path"

import type { SessionState } from "../index.js"
import { hasLiterateFrontmatter, parseLiterateMarkdown, parseLiterateFrontmatter } from "./parser.js"
import { interpolate } from "./interpolation.js"
import { processScripts } from "./executor.js"
import { buildParseFormatInstruction, processParse } from "./parse.js"
import { resolveNextStep } from "./routing.js"

// ============================================================================
// Constants
// ============================================================================

const COMMANDS_DIR = ".opencode/commands"

// State per session
const sessionStates = new Map<string, SessionState>()

async function log(_client: unknown, _msg: string): Promise<void> {
    // console.error("INFO [literate-commands]", msg)
}

/**
 * Extract text from the latest assistant message in a session.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLatestAssistantResponse(client: any, sessionID: string): Promise<string | null> {
    try {
        const response = await client.session.messages({ path: { id: sessionID } })
        const messages = response.data

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
// Main Plugin
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function literateCommandsPlugin({ client, $ }: { client: any; $: any }) {
    await log(client, "[literate-commands] Plugin initialized")

    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "command.execute.before": async (input: any, outputObj: any) => {
            const { command, sessionID, arguments: args } = input

            await log(client, `[literate-commands] Intercepting /${command}`)

            // Load command markdown
            const commandPath = join(COMMANDS_DIR, `${command}.md`)

            if (!existsSync(commandPath)) {
                await log(client, `[literate-commands] Command not found: ${commandPath}`)
                return
            }

            const content = readFileSync(commandPath, "utf-8")

            const isLiterate = hasLiterateFrontmatter(content)

            if (!isLiterate) {
                await log(client, `[literate-commands] /${command} is not literate, skipping`)
                return
            }

            await log(client, `[literate-commands] /${command} is literate, setting up state`)

            const frontmatter = parseLiterateFrontmatter(content)
            const agent = frontmatter.agent

            if (agent) {
                await log(client, `[literate-commands] Command specifies agent: ${agent}`)
            }

            const steps = parseLiterateMarkdown(content)
            await log(client, `[literate-commands] Parsed ${steps.length} steps`)

            await log(client, `[literate-commands] Parsed ${steps.length} steps:`)
            for (let i = 0; i < steps.length; i++) {
                await log(client, `[literate-commands]   Step ${i}: "${steps[i].prompt.slice(0, 50)}..."`)
            }

            sessionStates.set(sessionID, {
                steps,
                currentStep: 0,
                metadata: { ARGUMENTS: args || "" },
                sessionID,
                commandName: command,
                agent,
                pendingParse: null,
                retries: 3,
                awaitingResponse: false,
                awaitingRetry: false
            })
            await log(client, `[literate-commands] State set for session ${sessionID}`)

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const out = outputObj as any
            out.parts.length = 1
            out.parts[0] = {
                type: "text",
                text: `We are preparing to run the /${command} command.\nI will give you more instructions.\nPlease acknowledge and await.`
            }
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

            const stepIndex = state.currentStep
            const step = state.steps[stepIndex]
            if (!step) {
                await log(client, `[literate-commands] No more steps, done`)
                sessionStates.delete(sessionID)
                return
            }

            // Handle waiting states (parse response, then inject NEXT step)
            if (state.awaitingRetry || state.awaitingResponse) {
                const responseText = await getLatestAssistantResponse(client, sessionID)
                await log(client, `[literate-commands] Got response: ${responseText?.slice(0, 100) || "null"}...`)

                if (!responseText) {
                    await log(client, `[literate-commands] No response yet, waiting...`)
                    return
                }

                const parseResult = processParse(step, responseText, state.metadata, client)

                if (parseResult.success) {
                    state.awaitingRetry = false
                    state.awaitingResponse = false
                    state.pendingParse = null
                    state.retries = 3
                    await log(client, `[literate-commands] Parse succeeded, metadata: ${JSON.stringify(state.metadata)}`)

                    const routedIndex = resolveNextStep(step.config.next, state.steps, state.metadata)
                    if (routedIndex !== null) {
                        await log(client, `[literate-commands] Routing to step ${routedIndex} via next config`)
                        state.currentStep = routedIndex
                    } else {
                        state.currentStep++
                        await log(client, `[literate-commands] Advancing to step ${state.currentStep}`)
                    }

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
                    const body1: { parts: Array<{ type: string; text: string }>; agent?: string } = { parts: [{ type: "text", text: finalPrompt }] }
                    if (state.agent) body1.agent = state.agent
                    await client.session.promptAsync({
                        path: { id: sessionID },
                        body: body1
                    })

                    if (!nextStep.config.parse) {
                        const nextRoutedIndex = resolveNextStep(nextStep.config.next, state.steps, state.metadata)
                        if (nextRoutedIndex !== null) {
                            state.currentStep = nextRoutedIndex
                        } else {
                            state.currentStep++
                        }
                    }
                    return
                } else {
                    state.retries--
                    state.awaitingRetry = true
                    state.awaitingResponse = false
                    await log(client, `[literate-commands] Parse failed (${state.retries} retries left): ${parseResult.error}`)

                    if (state.retries > 0) {
                        const retryPrompt = `Could not parse your response as valid JSON. Error: ${parseResult.error}\n\nPlease respond with ONLY a JSON block containing the required keys. Format: {${Object.keys(state.pendingParse || step.config.parse || {}).join(", ")}}.`
                        const body2: { parts: Array<{ type: string; text: string }>; agent?: string } = { parts: [{ type: "text", text: retryPrompt }] }
                        if (state.agent) body2.agent = state.agent
                        await client.session.promptAsync({
                            path: { id: sessionID },
                            body: body2
                        })
                    } else {
                        const stopPrompt = `Command stopped. Parse failed after 3 retries at step ${stepIndex}.\n\nCurrent step: "${step.prompt.slice(0, 100)}..."\nVariables so far: ${JSON.stringify(state.metadata)}\n\nPlease provide instructions.`
                        const body3: { parts: Array<{ type: string; text: string }>; agent?: string } = { parts: [{ type: "text", text: stopPrompt }] }
                        if (state.agent) body3.agent = state.agent
                        await client.session.promptAsync({
                            path: { id: sessionID },
                            body: body3
                        })
                        sessionStates.delete(sessionID)
                    }
                    return
                }
            }

            // Fresh step - process and inject
            await log(client, `[literate-commands] Processing step ${stepIndex}: "${step.prompt.slice(0, 50)}..."`)

            const processedPrompt = await processScripts(step, state.metadata, $)
            let finalPrompt = interpolate(processedPrompt, state.metadata)

            if (step.config.parse) {
                const formatInstruction = buildParseFormatInstruction(step.config.parse)
                finalPrompt = finalPrompt + formatInstruction
                state.pendingParse = step.config.parse
                state.awaitingResponse = true
                await log(client, `[literate-commands] Added parse instruction, awaiting response`)
            }

            await log(client, `[literate-commands] Injecting: ${finalPrompt.slice(0, 100)}...`)

            const body4: { parts: Array<{ type: string; text: string }>; agent?: string } = { parts: [{ type: "text", text: finalPrompt }] }
            if (state.agent) body4.agent = state.agent
            await client.session.promptAsync({
                path: { id: sessionID },
                body: body4
            })

            if (step.config.stop === true) {
                await log(client, `[literate-commands] Stop requested, ending command`)
                sessionStates.delete(sessionID)
                return
            }

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

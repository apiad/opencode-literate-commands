/**
 * Parse Functions Module
 * 
 * Handles JSON parsing from model responses.
 */

import type { Metadata, Step } from "../index.js"

// ============================================================================
// Public Functions
// ============================================================================

/**
 * Build JSON format instruction from parse config keys.
 *
 * Input: { message: "string", count: "number", active: "bool" }
 * Output: "\n\nFormat your response as JSON with the following keys: {message, count, active}. DO NOT add anything before or after the JSON response, as it will be used for parsing."
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseResponse(responseText: string, parseConfig: any): { success: boolean; data?: Record<string, unknown>; error?: string } {
    let jsonString: string | null = null

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function processParse(step: any, responseText: string, metadata: Metadata, client: any): { success: boolean; data?: Metadata; error?: string } {
    if (!step.config.parse) {
        return { success: true, data: metadata }
    }

    const result = parseResponse(responseText, step.config.parse)

    if (result.success) {
        // Merge parsed data into metadata
        Object.assign(metadata, result.data)
        return { success: true, data: metadata }
    } else {
        return { success: false, error: result.error }
    }
}

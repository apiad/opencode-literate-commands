/**
 * TypeScript type definitions for literate-commands plugin
 */

/**
 * A code block extracted from markdown
 */
export interface CodeBlock {
  /** Programming language (bash, python, javascript, etc.) */
  language: string
  /** Metadata tags from the block header (e.g., {exec}, {exec mode=store}) */
  meta: string[]
  /** The actual code content */
  code: string
  /** The full block including delimiters, for replacement */
  fullBlock: string
}

/**
 * Configuration for a single step
 */
export interface StepConfig {
  /** Unique identifier for the step */
  step?: string
  /** Variables to extract from the model's response */
  parse?: Record<string, "string" | "number" | "bool">
  /** Routing configuration - step name or conditional map */
  next?: string | Record<string, string>
  /** If true, end the command after this step */
  stop?: boolean
}

/**
 * A single step in the command workflow
 */
export interface Step {
  /** Step configuration from the YAML block */
  config: StepConfig
  /** The prompt text with code blocks */
  prompt: string
  /** All code blocks in this step */
  codeBlocks: CodeBlock[]
}

/**
 * State for an active session executing a command
 */
export interface SessionState {
  /** All parsed steps from the command markdown */
  steps: Step[]
  /** Current step index */
  currentStep: number
  /** Variables collected during execution */
  metadata: Metadata
  /** Session identifier */
  sessionID: string
  /** Name of the command being executed */
  commandName: string
  /** Parse configuration waiting for response */
  pendingParse?: Record<string, "string" | "number" | "bool">
  /** Remaining retry attempts for parse failures */
  retries: number
  /** Whether waiting for model response with parse data */
  awaitingResponse: boolean
  /** Whether waiting for retry response after parse failure */
  awaitingRetry: boolean
}

/**
 * Metadata object for variable substitution
 */
export type Metadata = Record<string, unknown>

/**
 * Result of parsing the model's response
 */
export interface ParseResult {
  /** Whether parsing succeeded */
  success: boolean
  /** Extracted variables if successful */
  data?: Metadata
  /** Error message if failed */
  error?: string
}

/**
 * Result of executing a script block
 */
export interface ExecResult {
  /** Standard output from the script */
  output: string
  /** Stored variables from JSON output (mode=store) */
  stored: Metadata | null
}

/**
 * Plugin configuration options
 */
export interface LiterateCommandsOptions {
  /** Directory containing command markdown files */
  commandsDir?: string
  /** Default timeout for script execution in milliseconds */
  defaultTimeout?: number
  /** Enable Docker execution for scripts */
  dockerEnabled?: boolean
  /** Docker image to use when dockerEnabled is true */
  dockerImage?: string
}

/**
 * Default configuration values
 */
export const DEFAULT_OPTIONS: Required<LiterateCommandsOptions> = {
  commandsDir: ".opencode/commands",
  defaultTimeout: 30000,
  dockerEnabled: false,
  dockerImage: "python:3.11",
}

/**
 * Known interpreter mappings
 */
export const INTERPRETERS: Record<string, string> = {
  python: "python3",
  python3: "python3",
  bash: "bash",
  sh: "sh",
  javascript: "node",
  js: "node",
}

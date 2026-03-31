# Architecture

This page documents how the literate-commands plugin works internally. Use this to understand the processing flow, extend the plugin, or debug issues.

## Overview

The literate-commands plugin intercepts slash command execution and transforms markdown files into interactive, multi-step workflows. It processes commands in a pipeline that parses steps, collects variables, routes based on conditions, and executes scripts.

## High-Level Workflow

```
User invokes /command
        │
        ▼
┌─────────────────┐
│ Initialize      │ ← command.execute.before hook
│ Command State   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Parse Markdown  │ ← Extract steps, config, scripts
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Process Step    │
│ • Show prompt   │
│ • Execute exec  │
│ • Parse collect │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Route Next Step │ ← Evaluate conditions, find target
└────────┬────────┘
         │
         ├─── "stop" ───► End command
         │
         ▼
┌─────────────────┐
│ Process Next    │ ← session.idle hook
│ Step            │
└────────┬────────┘
         │
         └─── loop until stop
```

## Event Hooks

The plugin registers two event hooks:

### `command.execute.before`

Fires when a slash command is invoked. Responsibilities:

1. Check if command has `literate: true` in frontmatter
2. Parse the markdown into structured steps
3. Initialize session state for tracking progress
4. Trigger the first step

### `session.idle`

Fires when the agent is idle. Responsibilities:

1. Check if we're in an active literate command session
2. Process the current step:
   - Interpolate variables into prompts
   - Execute `{exec}` code blocks
   - Collect variables from the model's response
3. Resolve the next step based on routing
4. Continue to next step or end

## Processing Pipeline

### 1. Parse Markdown

The `parser.ts` module extracts structured data from the markdown file:

```
Markdown Text
    │
    ▼
┌──────────────────────────────────────┐
│ 1. Detect literate frontmatter       │
│    literate: true                    │
├──────────────────────────────────────┤
│ 2. Split into steps (--- separator) │
├──────────────────────────────────────┤
│ 3. Extract config from {config}      │
│    blocks                            │
├──────────────────────────────────────┤
│ 4. Extract {exec} code blocks        │
│    with metadata                     │
├──────────────────────────────────────┤
│ 5. Parse YAML config                 │
│    step, parse, next, stop, exec     │
└──────────────────────────────────────┘
    │
    ▼
Step[] with config, prompts, scripts
```

### 2. Interpolate Variables

The `interpolation.ts` module replaces `$variable` placeholders:

| Syntax | Example | Result |
|--------|---------|--------|
| `$name` | `$name` | Alice |
| `$obj.prop` | `$user.email` | alice@example.com |
| `$arr.0` | `$items.0` | first item |
| `$$` | `$$` | Full metadata JSON |

Interpolation happens in:
- Step prompts (shown to the user)
- Script content (before execution)
- Routing conditions (for evaluation)

### 3. Execute Scripts

The `executor.ts` module runs `{exec}` code blocks:

```
Code Block
    │
    ▼
┌──────────────────────────────────────┐
│ Parse metadata: {exec mode=store}    │
├──────────────────────────────────────┤
│ Select interpreter based on lang     │
│ • bash → /bin/sh                    │
│ • python → python3                  │
│ • node → node                       │
│ • Or custom from {exec=cmd}         │
├──────────────────────────────────────┤
│ Interpolate variables into script   │
├──────────────────────────────────────┤
│ Execute via interpreter             │
├──────────────────────────────────────┤
│ Handle output based on mode         │
│ • stdout → show to user             │
│ • store → parse JSON, save vars     │
│ • none → suppress output            │
└──────────────────────────────────────┘
```

### 4. Collect Variables

The `parse.ts` module extracts structured data from the model's response:

```
Model Response
    │
    ▼
┌──────────────────────────────────────┐
│ Build format instruction from config │
│ parse: {name: string, age: number}  │
├──────────────────────────────────────┤
│ Prompt model to respond with JSON    │
├──────────────────────────────────────┤
│ Extract JSON from response           │
├──────────────────────────────────────┤
│ Coerce types (string, number, bool)  │
├──────────────────────────────────────┤
│ Merge into metadata                  │
└──────────────────────────────────────┘
```

### 5. Route to Next Step

The `routing.ts` module determines the next step:

```
Current Step Config
    │
    ▼
┌──────────────────────────────────────┐
│ Check for explicit `next`           │
├──────────────────────────────────────┤
│ If next is string → use as step name │
├──────────────────────────────────────┤
│ If next is object → evaluate conds   │
│ • "role === 'admin'" → admin-step   │
│ • "confirmed === true" → proceed    │
│ • _ → fallback-step                 │
├──────────────────────────────────────┤
│ Find step by name in steps array     │
├──────────────────────────────────────┤
│ Check for `stop: true`              │
└──────────────────────────────────────┘
    │
    ▼
Next Step or End
```

## Module Responsibilities

| Module | Purpose |
|--------|---------|
| `parser.ts` | Parse markdown, extract steps, config, code blocks |
| `interpolation.ts` | Replace `$variable` with values |
| `executor.ts` | Run `{exec}` scripts via interpreters |
| `parse.ts` | Extract variables from model responses |
| `routing.ts` | Determine next step based on conditions |
| `plugin.ts` | Main hook handlers, state management |

## State Management

The plugin maintains state per session:

```javascript
sessionStates = Map<sessionId, {
  commandPath: string,
  steps: Step[],
  currentStep: number,
  metadata: Record<string, any>
}>
```

State is stored in memory during the command session and cleared when:
- The command reaches a step with `stop: true`
- The user cancels or starts a new command
- The session ends

## Extending the Plugin

### Adding New Interpreters

Edit `executor.ts` to add to the `INTERPRETERS` map:

```javascript
const INTERPRETERS = {
  bash: "/bin/sh",
  sh: "/bin/sh",
  python: "python3",
  python3: "python3",
  node: "node",
  // Add your interpreter:
  ruby: "ruby",
  php: "php",
};
```

Or specify per-block with `{exec=ruby}`:

````markdown
```ruby {exec=ruby}
puts "Hello!"
```
````

### Custom Variable Types

Edit `parser.ts` `parseValue()` function to add type coercion:

```javascript
function parseValue(value, type) {
  switch (type) {
    case "string": return String(value);
    case "number": return Number(value);
    case "bool": return value === "true" || value === "true";
    // Add custom type:
    case "json": return JSON.parse(value);
    case "array": return Array.isArray(value) ? value : [value];
    default: return value;
  }
}
```

### Custom Routing Conditions

Edit `routing.ts` `evaluateCondition()` to add functions:

```javascript
function evaluateCondition(condition, metadata) {
  // Existing: ===, !==, >, <, >=, <=, includes, etc.
  // Add custom:
  if (condition.includes(".has(")) {
    return evaluateHasCondition(condition, metadata);
  }
  // ...
}
```

## Event Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ User invokes: /new-project                                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ command.execute.before                                          │
│ • Has literate frontmatter?                                     │
│ • Parse markdown into steps                                    │
│ • Initialize session state                                      │
│ • Start with step 0                                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ session.idle (step 0: project-info)                            │
│ • Show prompt: "What would you like to name your project?"      │
│ • Collect: name (string)                                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ session.idle (step 1: confirm)                                  │
│ • Show prompt with $name interpolated                           │
│ • Collect: confirmed (bool)                                     │
│ • Route based on confirmed                                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
               "confirmed"         "!"
                    │                 │
                    ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ step: create                                                    │
│ • Show prompt with status                                      │
│ • Execute {exec} script                                        │
│ • Run: mkdir "$name" && git init                              │
│ • Continue to step 2                                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ step: success                                                   │
│ • Show: "✓ Project $name created!"                             │
│ • stop: true                                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Command ends                                                    │
│ • Clear session state                                          │
│ • Return to normal agent behavior                             │
└─────────────────────────────────────────────────────────────────┘
```

## Debugging

Enable debug logging to see the processing flow:

```bash
opencode run --print-logs --log-level DEBUG --command your-command
```

Look for logs tagged with:
- `literate-commands` — Plugin initialization
- `step-processing` — Step execution
- `variable-collection` — Parsing and storing variables
- `routing` — Step routing decisions
- `script-execution` — `{exec}` block runs

## Related

- [User Guide](user-guide.md) — How to use literate commands
- [Installation](install.md) — How to install the plugin
- [GitHub Repository](https://github.com/apiad/opencode-literate-commands)

# Literate Commands Skill

This page contains instructions for synthesizing your own skill for authoring literate commands.

## Why Synthesize Your Own Skill?

The documentation and examples provide a foundation, but your skill should reflect your actual usage:

- **Your specific workflows** — Common patterns you use repeatedly
- **Your project conventions** — Naming standards, file locations, practices
- **Your edge cases** — Situations you've encountered and solved
- **Your discoveries** — Best practices you've found through experience

## How to Synthesize Your Skill

### Step 1: Read the User Guide

Start by reading [user-guide.md](user-guide.md) to understand:

- What literate commands are and when to use them
- Step configuration options
- Variable collection and routing
- Script execution patterns
- Security considerations

### Step 2: Review the Architecture

Read [architecture.md](architecture.md) to understand:

- How the plugin processes steps
- The processing pipeline flow
- Event hooks and lifecycle
- Module responsibilities

### Step 3: Reflect on Your Use Cases

Consider:

- What complex workflows do you repeatedly perform?
- What data do you commonly collect from users?
- What conditional logic do your processes require?
- What scripts do you frequently execute?

### Step 4: Write Your Skill

Create a skill that includes:

1. **When to use literate commands** — Your criteria
2. **Your naming conventions** — Step names, file names, variable names
3. **Your common patterns** — Templates for your frequent workflows
4. **Your edge case handling** — How you deal with unusual situations
5. **Your best practices** — Lessons learned from experience

## What Makes a Good Skill?

A good literate commands skill:

- Is **specific** to your workflow, not generic
- Includes **real examples** from your use cases
- Documents **patterns** not covered in the user guide
- Provides **templates** you can copy and adapt
- Is **living** — you update it as you learn more

## Example Skill Structure

```markdown
---
name: my-literates
description: My personal patterns for literate commands
---

# My Literate Commands Skill

## When to Create a Literate Command

I create literate commands when:
- The task requires more than 2 distinct steps
- I need to collect structured input from the user
- The workflow branches based on conditions
- I want to execute scripts with interpolated variables

## Naming Conventions

- Step names: `kebab-case` with verb-noun (e.g., `collect-name`, `confirm-action`)
- Command files: `kebab-case` matching the action (e.g., `new-project.md`)
- Variables: `camelCase` (e.g., `projectName`, `isConfirmed`)

## Common Patterns

### Simple Confirmation

```yaml {config}
step: confirm
parse:
  confirmed: bool
next:
  "confirmed === true": proceed
  _: cancel
```

### Multi-Item Collection

```yaml {config}
parse:
  items: string
```

## My Best Practices

1. Always include a `cancel` step for negative confirmations
2. Validate expensive operations before executing
3. Use `mode=store` for script results that affect flow
4. Document what each step does in comments

## Save Your Skill

Save your synthesized skill to:

```
.opencode/skills/literate-commands/SKILL.md
```

## Keep It Updated

As you use literate commands more:

- Add new patterns you discover
- Refine existing templates
- Document edge cases you've solved
- Share improvements with your team

Your skill is a living document — treat it as such.

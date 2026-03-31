# Literate Commands

Multi-step guided workflows for opencode agents with variable collection, conditional logic, and automated script execution.

## Overview

Literate commands are markdown files that define interactive, multi-step workflows. Unlike regular slash commands that execute a single action, literate commands:

- **Walk users through complex processes** step by step
- **Collect structured data** before proceeding
- **Branch conditionally** based on user input or computed values
- **Execute scripts** with interpolated variables
- **Maintain state** across steps

## Features

| Feature | Description |
|---------|-------------|
| Multi-step workflows | Break complex tasks into digestible steps |
| Variable collection | Prompt for and store structured data |
| Conditional routing | Branch based on conditions |
| Script execution | Run code (bash, python, node) with variables |
| Variable interpolation | Use `$variable` syntax in prompts and scripts |

## Security Warning

!!! warning "⚠️ Arbitrary Code Execution"

    This plugin executes arbitrary code from markdown files.
    
    - Literate commands can run shell scripts, Python, Node.js, and other interpreters
    - **Always review command files before executing them**
    - Don't run literate commands from untrusted sources
    - The plugin provides no sandboxing

## Quick Start

For **users**: See [User Guide](user-guide.md) to understand when and how to create literate commands.

For **agents**: See [Installation](install.md) to install this plugin in your project.

## Documentation

| Page | Purpose |
|------|---------|
| [User Guide](user-guide.md) | Learn what literate commands are and how to create them |
| [Installation](install.md) | Step-by-step setup instructions for agents |
| [Skill](skill.md) | Instructions for synthesizing your own skill |
| [Architecture](architecture.md) | How the plugin works (for developers) |

## Example

```markdown
---
description: Project setup wizard
literate: true
---

```yaml {config}
step: project-name
parse:
  name: string
```
What would you like to name your project?

---

```yaml {config}
step: confirm
next:
  "confirmed === true": create
  _: cancel
```
Ready to create **$name**? Type `true` or `false`.

---

```yaml {config}
step: success
stop: true
```
✓ Project **$name** created!
```

---

*Part of the [opencode-literate-commands](https://github.com/apiad/opencode-literate-commands) project.*

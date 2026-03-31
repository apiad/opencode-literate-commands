# Installation

This page contains step-by-step instructions for installing the literate-commands plugin. Follow each step carefully.

## Security Warning

!!! warning "⚠️ Arbitrary Code Execution"

    This plugin executes arbitrary code from markdown files.
    
    - Literate commands can run shell scripts, Python, Node.js, and other interpreters
    - **Always review command files before executing them**
    - Don't run literate commands from untrusted sources
    - The plugin provides no sandboxing

## Step 1: Install the Plugin

### 1.1 Create the plugins directory

If it doesn't already exist, create the `.opencode/plugins/` directory in your project:

```bash
mkdir -p .opencode/plugins
```

### 1.2 Download the plugin

Download `literate-commands.js` from GitHub:

```bash
curl -o .opencode/plugins/literate-commands.js \
  https://raw.githubusercontent.com/apiad/opencode-literate-commands/main/literate-commands.js
```

Or manually:

1. Go to: `https://github.com/apiad/opencode-literate-commands`
2. Click on `literate-commands.js`
3. Click the "Raw" button
4. Save the file to `.opencode/plugins/literate-commands.js`

## Step 2: Register the Plugin

Open your `opencode.json` configuration file and add the `plugins` array:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "analyze",
  "instructions": [".opencode/instructions.md"],
  "plugins": ["literate-commands"]
}
```

If you already have a `plugins` array, add `"literate-commands"` to it:

```json
{
  "plugins": [
    "literate-commands",
    "other-plugin"
  ]
}
```

## Step 3: Create Your Skill (Recommended)

The plugin is now installed, but you should create a personalized skill for authoring literate commands.

### 3.1 Create the skills directory

```bash
mkdir -p .opencode/skills/literate-commands
```

### 3.2 Read the user guide

Before creating your skill, read `docs/user-guide.md` to understand:

- What literate commands are
- How to structure steps
- Variable collection and routing
- Script execution patterns

### 3.3 Synthesize your own skill

Based on your reading and your specific use cases, create your own skill file:

```bash
touch .opencode/skills/literate-commands/SKILL.md
```

Your skill should include:

- **Common patterns** you use frequently
- **Your project conventions** and naming standards
- **Edge cases** you've encountered
- **Best practices** you've discovered

The built-in skill will always be a starting point. Your synthesized skill will be better because it reflects your actual usage patterns.

## Verification

To verify the plugin is installed correctly, run:

```bash
opencode --version
```

If you see version output without errors, the plugin is loaded.

## Creating Your First Literate Command

Now that the plugin is installed, create your first literate command:

```bash
touch .opencode/commands/my-command.md
```

Add this content:

```markdown
---
description: My first literate command
literate: true
---

```yaml {config}
step: hello
stop: true
```
Hello! This is a literate command. Edit this file to create your workflow.
```

Run it:

```bash
opencode /my-command
```

## Troubleshooting

### Plugin not loading

1. Check that `literate-commands.js` exists at `.opencode/plugins/literate-commands.js`
2. Verify `opencode.json` has `"literate-commands"` in the plugins array
3. Check for syntax errors in `opencode.json` using a JSON validator

### Commands not recognized

1. Ensure the markdown file is in `.opencode/commands/`
2. Check that the frontmatter includes `literate: true`
3. Verify the file has `.md` extension

### Scripts not executing

1. Make sure code blocks have `{exec}` annotation
2. Check that the interpreter is available (bash, python3, node, etc.)
3. Review the script syntax

## Next Steps

- **[User Guide](user-guide.md)** — Learn how to create literate commands
- **[Architecture](architecture.md)** — Understand how the plugin works

---

✓ **Installation complete!** The literate-commands plugin is now installed in your project.

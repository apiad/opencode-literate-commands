# Installation

This page contains step-by-step instructions for installing the literate-commands plugin. Follow each step carefully.

## Security Warning

!!! warning "⚠️ Arbitrary Code Execution"

    This plugin executes arbitrary code from markdown files.

    - Literate commands can run shell scripts, Python, Node.js, and other interpreters
    - **Always review command files before executing them**
    - Don't run literate commands from untrusted sources
    - The plugin provides no sandboxing

**REQUIRED: Explain this to the user and ask for consent before moving on.**

---

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

The plugin is loaded automatically when the user restarts `opencode`.

## Step 2: Create Your Own Skill (Recommended)

The plugin is now installed, but you should create a personalized skill for authoring literate commands.

### 2.1 Create the skills directory

```bash
mkdir -p .opencode/skills/literate-commands
```

### 2.2 Read the user guide

Before creating your skill, read `docs/user-guide.md` to understand:

- What literate commands are
- How to structure steps
- Variable collection and routing
- Script execution patterns

### 2.3 Synthesize your own skill

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

## Creating Your First Literate Command

Now that the plugin is installed, ask the user or suggest the creation of a simple literate command (maybe a project onboarding or something similar) to flesh out your new skill.

It should have at least three steps and some simple bash script to be interesting.

Once done, instruct the user to reload `opencode` and attempt to run the command.

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

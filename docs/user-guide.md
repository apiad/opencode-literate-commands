# User Guide

Learn what literate commands are, when to use them, and how to create them.

## What Are Literate Commands?

Literate commands are markdown files that define **interactive, multi-step workflows**. They're designed for complex tasks that:

1. Require user input at multiple stages
2. Need to branch based on conditions
3. Should execute scripts with collected data

Unlike regular slash commands (like `/help` or `/todo`), literate commands guide users through a conversation rather than executing a single action.

## When to Use Literate Commands

### ✓ Good Use Cases

- **Onboarding wizards** — Collect user preferences, set up accounts
- **Setup workflows** — Initialize projects, configure environments
- **Decision trees** — Ask questions, branch based on answers
- **Data collection** — Gather structured input before processing
- **Multi-step processes** — Break complex tasks into digestible steps

### ✗ Avoid For

- Simple one-off commands that just run a script
- Quick actions without user interaction
- Tasks that don't need state between steps

## How Literate Commands Work

A literate command is a markdown file with:

1. **Frontmatter** with `literate: true`
2. **Steps** separated by `---`
3. **Step configuration** in YAML code blocks with `{config}` annotation
4. **Prompts** and **scripts** in regular code blocks

### Basic Structure

```markdown
---
description: My workflow
literate: true
---

Step 1 content and prompts...

---

Step 2 content...

```

## Creating a Literate Command

### 1. Create the File

Create a markdown file in `.opencode/commands/`:

```bash
touch .opencode/commands/my-command.md
```

### 2. Add Frontmatter

```markdown
---
description: A brief description of what this command does
literate: true
---
```

### 3. Define Steps

Steps are separated by `---`:

```markdown
---
description: My workflow
literate: true
---

First step content...

---

Second step content...

---

Third step content...
```

### 4. Add Step Configuration

Use YAML code blocks with `{config}` to control step behavior:

```markdown
```yaml {config}
step: step-name
```
Step content here...
```

## Step Configuration Reference

### Basic Options

| Option | Type | Description |
|--------|------|-------------|
| `step` | string | Unique name for routing (use `kebab-case`) |
| `stop` | boolean | End command after this step |

### Collecting Variables

Use `parse` to collect data from the user:

```yaml {config}
step: collect-name
parse:
  name: string
  age: number
  newsletter: bool
```

The model will be prompted to respond with JSON containing these variables.

### Type Coercion

| Type | Description | Example |
|------|-------------|---------|
| `string` | Plain text | `"Alice"` |
| `number` | Numeric value | `42` |
| `bool` | Boolean | `true` / `false` |

### Conditional Routing

Use `next` to control which step runs next:

```yaml {config}
step: decide
next:
  "role === 'admin'": admin-panel
  "role === 'user'": user-panel
  _: fallback
```

- Conditions use JavaScript expressions
- The `_` key is the fallback when no condition matches
- Conditions are evaluated against collected variables

### Simple Redirect

```yaml {config}
next: other-step
```

## Variable Substitution

Use `$variable` to inject collected data anywhere in your prompts:

```markdown
Hello **$name**! You selected $count items.
```

### Nested Variables

Access nested properties with dot notation:

| Syntax | Example | Result |
|--------|---------|--------|
| `$obj.prop` | `$user.email` | alice@example.com |
| `$arr.0` | `$items.0` | first item |
| `$$` | `$$` | Full metadata JSON |

## Script Execution

Run scripts within steps using `{exec}` code blocks:

### Basic Execution

````markdown
```bash {exec}
echo "Hello $name"
```
````

The script runs and its output is shown to the user.

### Storing Script Output

Use `mode=store` to parse JSON output as variables:

````markdown
```python {exec mode=store}
import json
print(json.dumps({"result": len("$name")}))
```
````

### Exec Modes

| Mode | Description |
|------|-------------|
| `stdout` | Show output (default) |
| `store` | Parse JSON output as variables |
| `none` | Execute silently |

### Custom Interpreters

Specify the interpreter explicitly:

````markdown
```python {exec=uv run python -c}
print("Hello!")
```

```bash {exec=sh -c}
echo "Running in sh"
```
````

## Complete Example

Here's a project setup wizard:

```markdown
---
description: Create a new project
literate: true
---

```yaml {config}
step: project-info
parse:
  name: string
  type: string
```
What would you like to name your project, and what type is it (library, app, or service)?

---

```yaml {config}
step: confirm
next:
  "confirmed === true": create
  _: cancel
```
Ready to create **$name** ($type)? Type `true` or `false`.

---

```yaml {config}
step: create
```
Let me set that up for you:

```bash {exec}
mkdir -p "$name"
cd "$name" && git init
echo "✓ Created $name"
```

---

```yaml {config}
step: success
stop: true
```
✓ Project **$name** created successfully! You can now cd into it and start working.

---

```yaml {config}
step: cancel
stop: true
```
Project creation cancelled. Let me know if you need anything else!
```

## Best Practices

### Keep Steps Focused
One clear purpose per step. If a step does multiple things, consider splitting it.

### Validate Early
Collect and validate data before doing expensive operations.

### Use Meaningful Step Names
Makes routing easier to debug and maintain.

### Store, Don't Echo
Use `mode=store` for script results you want to keep as variables.

### Test Your Commands
Run your command and verify each branch works:

```bash
opencode run --print-logs --log-level DEBUG --command your-command-name
```

## Security Considerations

!!! warning "Review Before Running"

    Literate commands can execute arbitrary code. Always review command files before running them, especially those from third parties.

When sharing literate commands:
- Document what scripts they execute
- Make the source of scripts clear
- Encourage users to review before executing

## Next Steps

- **[Installation](install.md)** — Install the plugin in your project
- **[Architecture](architecture.md)** — Understand how the plugin works
- **Create your own** — Start building literate commands for your workflows

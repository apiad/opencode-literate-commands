# opencode-literate-commands

An OpenCode plugin that enables step-by-step command execution from markdown files. Transform your CLI commands into interactive, guided workflows with variable substitution, conditional routing, and script execution.

## Features

- **Markdown-based commands** - Write commands as markdown with frontmatter
- **Step-by-step execution** - Break complex tasks into manageable steps
- **Variable substitution** - Pass data between steps with `$variable` syntax
- **JSON extraction** - Parse structured responses from the model
- **Conditional routing** - Branch based on user input with `next:` config
- **Script execution** - Run bash/python scripts within steps
- **Session state** - Maintain context across multiple turns

## Installation

For the old, boring way, read this:

<details>

### From npm

```bash
npm install opencode-literate-commands
```

Then add to your `opencode.json`:

```json
{
  "plugins": ["opencode-literate-commands"]
}
```

Then copy the [`SKILL.md`](./SKILL.md) file at the root of this repo to `.opencode/skills/literate-commands/` to teach your agent how to create new literate commands.

Enjoy!

### Local Development

```bash
git clone https://github.com/apiad/opencode-literate-commands.git
cd opencode-literate-commands
npm install
npm test
```

Link locally:

```bash
npm link
cd ~/.config/opencode
npm link opencode-literate-commands
```

</details>

But the simpler way is to just run `opencode`, switch to build mode (or a suitable mode) and ask:

```
Read https://apiad.github.io/opencode-literate-commands and install it.
```

You agent will know what to do.

## Command Format

Create markdown files in your `commandsDir` with the `literate: true` frontmatter:

    ---
    description: My command description
    literate: true
    ---

    ```yaml {config}
    step: step-one
    parse:
      name: "What is your name?"
    ```

    Your prompt text here. Variables like $name will be substituted.

    ---

    ```yaml {config}
    step: step-two
    next:
      "confirmed === true": success
      _: failure
    ```

    More content...

### Frontmatter

```yaml
---
description: Brief description of what this command does
literate: true  # Required - enables literate command processing
---
```

### Steps

Steps are separated by `---`. Each step contains:

1. **Config block** (optional): YAML configuration
2. **Prompt text**: What to show the model
3. **Code blocks**: Optional `{exec}` blocks to run

### Step Configuration

```yaml {config}
step: unique-step-name
parse:
  variable_name: "type"
next:
  "condition": target-step
  _: fallback-step
stop: true
```

| Key | Type | Description |
|-----|------|-------------|
| `step` | string | Unique identifier for routing |
| `parse` | object | Variables to extract from response |
| `next` | string \| object | Routing configuration |
| `stop` | boolean | End command after this step |

### Parse Types

```yaml
parse:
  name: "string"    # String value
  count: "number"   # Numeric value
  confirmed: "bool"  # Boolean value
```

The model will be asked to respond with JSON containing these keys.

### Routing

Simple redirect:

```yaml
next: other-step
```

Conditional routing:

```yaml
next:
  "role === 'admin'": admin-panel
  "role === 'user'": user-panel
  _: default-panel  # Fallback
```

### Code Blocks

Execute scripts within steps:

  ```bash {exec}
  echo "Hello $name"
  ```

  ```python {exec mode=store}
  import json
  print(json.dumps({"result": 42}))
  ```

| Syntax | Description |
|--------|-------------|
| `{exec}` | Execute and show output |
| `{exec mode=store}` | Execute, store JSON output as variables |
| `{exec mode=none}` | Execute silently (no output) |
| `{exec=interpreter}` | Use specific interpreter |

## Variable Substitution

Use `$variable` to reference collected data:

| Syntax | Description |
|--------|-------------|
| `$name` | Simple variable |
| `$user.name` | Nested property |
| `$items.0` | Array element |
| `$$` | Full metadata object |

### Examples

  Hello, **$name**!        → Hello, **Alice**!
  Count: $count            → Count: 42
  User: $user.email        → User: alice@example.com
  First item: $items.0     → First item: apple

### Shell Variables

For bash/sh scripts, variables are shell-safe:

```bash
echo '$name'  → echo 'Alice'
```

## Examples

See the `examples/` directory for sample commands:

- [`greeting.md`](examples/greeting.md) - Simple 3-step greeting with routing

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test
```

## Project Structure

```
opencode-literate-commands/
├── index.js           # Main plugin (ESM)
├── examples/
│   └── greeting.md    # Example command
└── README.md
```

## License

MIT

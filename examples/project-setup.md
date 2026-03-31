---
description: Interactive project setup workflow
literate: true
---

# Project Setup

This workflow helps you set up a new project with interactive prompts.

## Step 1: Project Details

```yaml {config}
step: project-details
parse:
  project_name: "string"
  description: "string"
```

Let's set up your project! I'll need a few details:

- **Project name**: What should we call your project?
- **Description**: A brief description of what it does

Please respond with JSON like:
```json
{
  "project_name": "my-awesome-project",
  "description": "A tool that does amazing things"
}
```

## Step 2: Tech Stack

```yaml {config}
step: tech-stack
parse:
  language: "string"
  framework: "string"
```

Great! Now let's choose your tech stack:

- **Language**: `python`, `javascript`, `typescript`, or `rust`?
- **Framework**: What framework would you like? (e.g., `fastapi`, `express`, `axum`)

Respond with:
```json
{
  "language": "python",
  "framework": "fastapi"
}
```

## Step 3: Features

```yaml {config}
step: features
parse:
  has_tests: "bool"
  has_docs: "bool"
```

Last few questions:

- **Tests**: Should I set up a test framework? (`true` or `false`)
- **Documentation**: Should I include documentation scaffolding? (`true` or `false`)

```json
{"has_tests": true, "has_docs": true}
```

## Step 4: Summary

```yaml {config}
step: summary
```

```bash {exec}
echo "Project: $project_name"
echo "Description: $description"
echo "Language: $language"
echo "Framework: $framework"
echo "Tests: $has_tests"
echo "Docs: $has_docs"
```

Here's your project configuration:

| Setting | Value |
|---------|-------|
| **Name** | $project_name |
| **Description** | $description |
| **Language** | $language |
| **Framework** | $framework |
| **Tests** | $has_tests |
| **Documentation** | $has_docs |

```bash {exec mode=none}
echo "Ready to create project '$project_name' with $language/$framework"
```

Shall I proceed with creating this project structure?

## Step 5: Create Project

```yaml {config}
step: create
stop: true
```

```bash {exec mode=store}
echo "Creating project structure for $project_name..."
# This would return JSON with created files
echo '{"files_created": ["README.md", "pyproject.toml", "src/main.py"], "status": "success"}'
```

Project **$project_name** has been created! 🎉

Files created:
- README.md
- pyproject.toml
- src/main.py

Your project is ready to go!

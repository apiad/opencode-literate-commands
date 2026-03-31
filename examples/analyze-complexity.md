---
description: Analyze code complexity
literate: true
---

# Code Complexity Analyzer

Analyze the complexity of a codebase using various metrics.

## Step 1: Source Directory

```yaml {config}
step: source-dir
parse:
  path: "string"
```

Please provide the path to the code you want to analyze.

You can use:
- `.` for current directory
- `src/` for a specific folder
- An absolute path like `/home/user/project`

```json
{"path": "src"}
```

## Step 2: Analysis

```yaml {config}
step: analyze
```

```bash {exec mode=store}
import json

# Simulated analysis - in real use, run actual complexity tools
result = {
    "files": 42,
    "lines": 3847,
    "functions": 156,
    "avg_complexity": 4.2,
    "high_complexity_count": 8,
    "largest_function": "process_user_data"
}
print(json.dumps(result))
```

Analyzing **$path**...

```python {exec mode=store}
# Simulated Python analysis
import json
print(json.dumps({
    "python_files": 15,
    "classes": 23,
    "methods": 89,
    "test_coverage": 67.5
}))
```

## Step 3: Results

```yaml {config}
step: results
```

### Analysis Complete

```bash {exec}
echo "=== Code Complexity Report ==="
```

| Metric | Value |
|--------|-------|
| Files | analyzing... |
| Lines of Code | calculating... |
| Functions | counting... |

### Python-Specific Metrics

| Metric | Value |
|--------|-------|
| Python Files | ... |
| Classes | ... |
| Methods | ... |
| Test Coverage | ...% |

## Step 4: Recommendations

```yaml {config}
step: recommendations
```

Based on the analysis, here are some recommendations:

```bash {exec}
echo "Checking for high complexity functions..."
```

### High Complexity Functions (>$avg_complexity)

The following functions may benefit from refactoring:

1. `$largest_function` - consider breaking into smaller functions
2. Review any functions with >10 branches

### Suggestions

- Consider adding more tests to improve coverage from `$test_coverage%` to 80%+
- High complexity count of $high_complexity_count functions should be reviewed

---

Shall I create a detailed report or help you refactor any specific function?

## Step 5: Detailed Report

```yaml {config}
step: detailed-report
stop: true
```

```bash {exec mode=store}
echo '{"report_file": "complexity-report.md", "format": "markdown", "generated": true}'
```

I've generated a detailed complexity report saved to `complexity-report.md`.

Summary:
- Total Files: $files
- Total Lines: $lines
- Total Functions: $functions
- Average Complexity: $avg_complexity
- High Complexity Functions: $high_complexity_count

The report includes detailed function-by-function analysis and specific refactoring suggestions.

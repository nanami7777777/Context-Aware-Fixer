# ContextFix

[![CI](https://github.com/nanami7777777/Context-Aware-Fixer/actions/workflows/ci.yml/badge.svg)](https://github.com/nanami7777777/Context-Aware-Fixer/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/contextfix.svg)](https://www.npmjs.com/package/contextfix)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

[English](./README.md) | [中文](./README.zh-CN.md)

Context-aware AI bug-fixing assistant for your codebase. Analyzes repository context — file dependencies, Git history, stack traces — and generates targeted fix patches using LLMs.

Built with TypeScript. Zero external SDK dependencies for LLM calls. Runs anywhere Node.js runs.

## Demo

```
$ contextfix analyze "TypeError: Cannot read properties of undefined (reading 'name') at processUser in src/pipeline.ts:15"

▶ Root Cause Analysis
────────────────────────────────────────

Summary: Missing null check in processData — data parameter can be undefined.

#1 [confidence: 95%]
  Location: src/pipeline.ts:15
  Description: processData accesses property 'name' without null check
  Impact: App crashes when data is undefined
  Evidence:
    • [code-snippet] src/pipeline.ts:15: return data.name;

#2 [confidence: 60%]
  Location: src/pipeline.ts:42
  Description: Caller passes unvalidated input to processData
  Impact: Secondary contributor — no input validation upstream
```

```
$ contextfix fix "TypeError: Cannot read properties of undefined" --dry-run

▶ Patch
ID: patch-1
Description: Add null guard before accessing data.name

--- src/pipeline.ts
+++ src/pipeline.ts
@@ -14,2 +14,5 @@
 function processData(data: any) {
+  if (data == null) {
+    return undefined;
+  }
   return data.name;
 }

✔ Patch preview (dry-run) — no files modified.
Files: src/pipeline.ts | +3 -0
```

## Why ContextFix

Most AI coding tools paste your error into a prompt and hope for the best. ContextFix takes a different approach:

1. **Parses** your error message, stack trace, or natural language bug description
2. **Collects** relevant code context — import graphs, Git blame, recent commits
3. **Scores** files by relevance using a weighted algorithm (mention × depth × trace × activity)
4. **Analyzes** root cause via LLM with the full context window
5. **Generates** unified diff patches you can review and apply

```
Input → Parse → Collect Context → Analyze Root Cause → Generate Patch → Output
```

## Quick Start

```bash
# Run directly with npx
npx contextfix fix "TypeError: Cannot read property 'x' of undefined"

# Or install globally
pnpm add -g contextfix
```

## Usage

### Fix a bug (full pipeline)

```bash
# From a CLI argument
contextfix fix "TypeError: Cannot read property 'x' of undefined"

# From a file
contextfix fix --file error.log

# From stdin
cat error.log | contextfix fix

# Apply the patch directly
contextfix fix "null pointer in UserService" --apply

# Preview changes without applying
contextfix fix "null pointer in UserService" --dry-run
```

### Analyze only (no patch generation)

```bash
contextfix analyze "app crashes when quantity is zero"
```

### Interactive chat mode

```bash
# Start an interactive session for iterative debugging
contextfix chat

# With a specific model
contextfix chat --model openai:kimi-k2.5 --base-url https://coding.dashscope.aliyuncs.com/v1
```

In chat mode you can ask follow-up questions, refine the analysis, and iterate on fixes. Commands: `/clear`, `/history`, `/quit`.

### Apply and verify

```bash
# Apply patch and run tests to verify the fix
contextfix fix "TypeError in handler" --apply --verify
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-m, --model <id>` | LLM model (`provider:model`) | `openai:gpt-4` |
| `-c, --context-limit <n>` | Max context window tokens | `8000` |
| `-v, --verbose` | Verbose logging | `false` |
| `-o, --output <file>` | Write output to file | stdout |
| `-b, --base-url <url>` | Custom API base URL | — |
| `--apply` | Apply patch to files | `false` |
| `--dry-run` | Preview patch without applying | `false` |
| `--verify` | Run tests after applying | `false` |
| `--json` | JSON output format | `false` |
| `-f, --file <path>` | Read bug description from file | — |

### Supported LLM Providers

```bash
# OpenAI (default)
contextfix fix "error" --model openai:gpt-4

# Anthropic Claude
contextfix fix "error" --model anthropic:claude-3-sonnet

# Ollama (local, no API key needed)
contextfix fix "error" --model ollama:codellama
```

## Configuration

ContextFix reads configuration from YAML files with this priority:

**Project** (`.contextfix.yml`) > **Global** (`~/.contextfix.yml`) > **Defaults**

```yaml
# .contextfix.yml
model: "openai:gpt-4"
apiKey: "sk-..."
contextLimit: 8000
ignorePatterns:
  - node_modules
  - dist
  - coverage
promptTemplates:
  analyze: "Custom analysis prompt"
```

### API Key Setup

```bash
# Via environment variable
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...

# Or in config file
echo 'apiKey: "sk-..."' > ~/.contextfix.yml
```

Ollama runs locally and doesn't require an API key.

## Supported Languages

ContextFix parses import/dependency graphs for:

- TypeScript / JavaScript (ES imports, CommonJS require, re-exports)
- Python (import, from...import)
- Java (import, import static)
- Go (single and block imports)
- Rust (use statements)

## Architecture

```
contextfix/
├── src/
│   ├── cli.ts                    # CLI entry (Commander.js)
│   ├── pipeline.ts               # Pipeline orchestrator
│   ├── input/                    # Input parsing & validation
│   ├── context/                  # Context collection
│   │   ├── collector.ts          # Main collector
│   │   ├── git-provider.ts       # Git history (simple-git)
│   │   ├── ast-parser.ts         # AST parsing
│   │   ├── dependency-resolver.ts # Dependency graph
│   │   ├── relevance-scorer.ts   # File relevance scoring
│   │   └── languages/            # Per-language import parsers
│   ├── analyzer/                 # LLM root cause analysis
│   ├── patch/                    # Patch generation & application
│   ├── llm/                      # LLM provider abstraction
│   ├── config/                   # YAML config management
│   └── output/                   # Terminal / JSON / plain formatters
```

### Pipeline Flow

```
User Input
  ↓
InputParser          → BugReport (error type, file paths, stack trace, keywords)
  ↓
ContextCollector     → ContextWindow (relevant files, git history, project info)
  ├── GitProvider         (file history, blame, .gitignore)
  ├── ASTParser           (import extraction)
  ├── DependencyResolver  (file dependency graph)
  └── RelevanceScorer     (weighted relevance scoring)
  ↓
RootCauseAnalyzer    → RootCauseReport (ranked candidates with evidence)
  ↓
PatchGenerator       → PatchSet (unified diff patches with pros/cons)
  ↓
OutputFormatter      → Formatted output (terminal / JSON / plain)
```

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Type check
pnpm lint

# Build
pnpm build

# Watch mode
pnpm dev
```

### Testing

The project uses Vitest for unit tests and fast-check for property-based tests. 417 tests across 36 test files, including 10 correctness properties:

- P1: Input parsing completeness
- P2: Config round-trip consistency
- P3: Context window token limit
- P4: Relevance score boundedness [0, 1]
- P5: Patch unified diff format validity
- P6: Mentioned files score higher
- P7: Stack trace order preservation
- P8: Config merge priority
- P9: .gitignore filtering consistency
- P10: Auto TTY detection (no ANSI in pipes)

## Comparison

| Feature | ContextFix | SWE-agent | Aider | Cursor |
|---------|-----------|-----------|-------|--------|
| Language | TypeScript | Python | Python | Electron |
| Install | `npx contextfix` | pip + docker | pip | Desktop app |
| Dependency graph analysis | ✅ | ❌ | ❌ | ❌ |
| Git history context | ✅ | ✅ | ✅ | ❌ |
| Relevance scoring | ✅ (weighted algorithm) | ❌ | ❌ | ❌ |
| Multi-language import parsing | ✅ (6 languages) | ❌ | ❌ | ❌ |
| Custom LLM endpoint | ✅ | ❌ | ✅ | ❌ |
| Ollama (local) | ✅ | ❌ | ✅ | ❌ |
| Unified diff output | ✅ | ✅ | ✅ | ❌ |
| Property-based tests | ✅ (10 properties) | ❌ | ❌ | ❌ |
| Bundle size | 97KB | — | — | — |

## Tech Stack

- **Runtime**: Node.js ≥ 18
- **Language**: TypeScript (strict mode, ES2022)
- **CLI**: Commander.js
- **LLM**: Native fetch (no SDK dependencies)
- **Git**: simple-git
- **Build**: tsup (esbuild)
- **Test**: Vitest + fast-check
- **Package Manager**: pnpm

## License

MIT

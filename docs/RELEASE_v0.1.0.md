# ContextFix v0.1.0

First release of ContextFix — a context-aware AI bug-fixing assistant.

## Features

- **Pipeline architecture**: Input → Context Collection → Root Cause Analysis → Patch Generation → Output
- **3 LLM providers**: OpenAI, Anthropic Claude, Ollama + custom OpenAI-compatible endpoints (`--base-url`)
- **6 language parsers**: TypeScript, JavaScript, Python, Java, Go, Rust (import/dependency graph)
- **Smart context collection**: relevance scoring, Git history, dependency graphs, .gitignore filtering
- **Root cause analysis**: ranked candidates with confidence scores and code evidence
- **Patch generation**: unified diff format with conflict detection, `--apply` and `--dry-run` modes
- **CLI**: `fix` and `analyze` commands, stdin/file/arg input, JSON/terminal/plain output
- **Config management**: YAML config with project > global > defaults priority
- **417 tests**: including 10 property-based correctness properties (fast-check)

## Install

```bash
npx contextfix fix "your error message"
```

## Quick Start

```bash
# OpenAI
export OPENAI_API_KEY=sk-...
contextfix fix "TypeError: Cannot read property 'x' of undefined"

# Custom endpoint (DashScope, Azure, etc.)
contextfix fix "error" --model openai:kimi-k2.5 --base-url https://your-endpoint.com/v1

# Ollama (local, no API key)
contextfix fix "error" --model ollama:codellama

# Analysis only
contextfix analyze "app crashes when quantity is zero"
```

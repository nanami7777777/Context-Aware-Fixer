# Contributing to ContextFix

Thanks for your interest in contributing! Here's how to get started.

## Setup

```bash
git clone https://github.com/nanami7777777/Context-Aware-Fixer.git
cd Context-Aware-Fixer
pnpm install
```

## Development

```bash
pnpm test          # Run all 417 tests
pnpm lint          # Type check (tsc --noEmit)
pnpm build         # Build to dist/
pnpm dev           # Watch mode
```

## Project Structure

```
src/
├── cli.ts              # CLI entry point (Commander.js)
├── pipeline.ts         # Pipeline orchestrator
├── input/              # Input parsing & validation
├── context/            # Context collection (Git, AST, dependencies, scoring)
├── analyzer/           # LLM root cause analysis
├── patch/              # Patch generation & application
├── llm/                # LLM provider abstraction (OpenAI, Anthropic, Ollama)
├── config/             # YAML config management
├── output/             # Output formatters (terminal, JSON, plain)
└── types.ts            # Shared type definitions
tests/
└── property/           # Property-based tests (fast-check)
```

## Adding a New Language Parser

1. Create `src/context/languages/yourlang.ts`
2. Implement the `LanguageParser` interface (see `typescript.ts` for reference)
3. Register it in `src/cli.ts` → `createLanguageRegistry()`
4. Add tests in `src/context/languages/yourlang.test.ts`

## Adding a New LLM Provider

1. Create `src/llm/yourprovider.ts` implementing `LLMProvider`
2. Add the provider name to `VALID_PROVIDERS` in `src/llm/provider.ts`
3. Wire it up in `createLLMProvider()` factory
4. Add tests

## Guidelines

- Keep PRs focused — one feature or fix per PR
- Add tests for new functionality
- Run `pnpm test && pnpm lint` before submitting
- Property-based tests go in `tests/property/`
- Use dependency injection for testability

## Reporting Issues

Use [GitHub Issues](https://github.com/nanami7777777/Context-Aware-Fixer/issues) with the provided templates.

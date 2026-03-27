# Show HN: ContextFix — AI Bug Fixer That Actually Reads Your Codebase

Most AI coding tools paste your error into a prompt and hope for the best. ContextFix takes a different approach: it reads your repo first.

**GitHub**: https://github.com/nanami7777777/Context-Aware-Fixer

## What it does

ContextFix is a CLI tool that:

1. Parses your error message / stack trace / natural language bug description
2. Walks your import graph to find related files
3. Checks Git blame and recent commits for context
4. Scores every file by relevance (weighted: mention × dependency depth × stack trace × commit activity)
5. Sends the most relevant context to an LLM for root cause analysis
6. Generates unified diff patches you can review and apply

```bash
npx contextfix fix "TypeError: Cannot read property 'x' of undefined"
```

## Why I built this

I was tired of copying error messages into ChatGPT, then manually pasting in 5 files of context, then explaining the project structure. The LLM needs context to give good answers — so why not automate the context collection?

The key insight: **which files you send to the LLM matters more than which LLM you use.** A relevance-scored context window with dependency graphs and Git history beats a raw error message every time.

## Technical highlights

- **TypeScript native** — not another Python wrapper. Zero-config `npx` experience for Node.js devs.
- **No LLM SDK dependencies** — uses native `fetch` for OpenAI, Anthropic, and Ollama. The entire bundle is 97KB.
- **Relevance scoring algorithm** — files are scored by: direct mention (0.4), import depth (0.3), stack trace presence (0.2), recent commit activity (0.1). Context window is filled greedily by score until the token limit.
- **Multi-language import parsing** — regex-based parsers for TypeScript, JavaScript, Python, Java, Go, Rust. Builds a dependency graph to find related files the error doesn't mention.
- **Property-based testing** — 417 tests including 10 formal correctness properties verified with fast-check (e.g., "context window never exceeds token limit", "mentioned files always score higher", "config round-trip consistency").
- **Custom endpoint support** — works with any OpenAI-compatible API (DashScope, Azure, local proxies).

## Architecture

```
Input → InputParser → ContextCollector → RootCauseAnalyzer → PatchGenerator → Output
                          ├── GitProvider (blame, history)
                          ├── ASTParser (import extraction)
                          ├── DependencyResolver (file graph)
                          └── RelevanceScorer (weighted scoring)
```

Each stage is a separate module with its own interface, fully testable via dependency injection.

## What's next

- VS Code extension
- GitHub Actions integration (auto-analyze failing CI)
- More language parsers (C/C++, Ruby, PHP)
- Smarter context: type definitions, test files, related PRs

Would love feedback. Try it out and let me know what breaks.

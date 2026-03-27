# Changelog

## [0.1.0] - 2025-03-27

### Added
- Pipeline architecture: Input → Context → Analyze → Patch → Output
- LLM providers: OpenAI, Anthropic Claude, Ollama
- Custom OpenAI-compatible endpoint support (`--base-url`)
- Multi-language import parsing: TypeScript, JavaScript, Python, Java, Go, Rust
- Context collection with relevance scoring, Git history, dependency graphs
- Root cause analysis with ranked candidates and evidence
- Unified diff patch generation with conflict detection
- Patch application (`--apply`) and preview (`--dry-run`)
- CLI with `fix` and `analyze` commands
- Input from CLI argument, stdin, or file (`--file`)
- Output formats: terminal (colored), JSON (`--json`), plain (auto-detected for pipes)
- YAML config management (project > global > defaults)
- 417 tests including 10 property-based correctness properties
- Bilingual README (English + Chinese)

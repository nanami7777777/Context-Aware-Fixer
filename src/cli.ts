// ContextFix CLI — main entry point

import { Command } from 'commander';
import { readFile as fsReadFile, writeFile as fsWriteFile, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import chalk from 'chalk';

import { ConfigManager } from './config/manager.js';
import { createLLMProvider } from './llm/provider.js';
import { InputParser } from './input/parser.js';
import { ContextCollector } from './context/collector.js';
import { GitProvider } from './context/git-provider.js';
import { ASTParser } from './context/ast-parser.js';
import { DependencyResolver } from './context/dependency-resolver.js';
import { RelevanceScorer } from './context/relevance-scorer.js';
import { RootCauseAnalyzer } from './analyzer/root-cause.js';
import { PatchGenerator } from './patch/generator.js';
import { PatchApplier } from './patch/applier.js';
import { createFormatter } from './output/formatter.js';
import { Pipeline } from './pipeline.js';
import { LanguageRegistry } from './context/languages/registry.js';
import { typescriptParser, javascriptParser } from './context/languages/typescript.js';
import { pythonParser } from './context/languages/python.js';
import { javaParser } from './context/languages/java.js';
import { goParser } from './context/languages/go.js';
import { rustParser } from './context/languages/rust.js';

import type { InputSource, OutputMode } from './types.js';
import type { FileReader as ContextFileReader } from './context/collector.js';
import type { FileReader as PatchFileReader, FileWriter } from './patch/applier.js';

// ─── CLI Options Interface ───────────────────────────────────────────────────

interface CLIOptions {
  model: string;
  contextLimit: number;
  verbose: boolean;
  output: string | null;
  apply: boolean;
  dryRun: boolean;
  json: boolean;
  file?: string;
  baseUrl?: string;
}

// ─── Progress Spinner ────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private message = '';
  private startTime = 0;
  private enabled: boolean;

  constructor() {
    this.enabled = process.stderr.isTTY === true;
  }

  start(message: string): void {
    this.message = message;
    this.startTime = Date.now();
    if (!this.enabled) {
      process.stderr.write(`  ${message}\n`);
      return;
    }
    this.frameIndex = 0;
    this.render();
    this.interval = setInterval(() => this.render(), 80);
  }

  succeed(message?: string): void {
    this.stop();
    const elapsed = this.formatElapsed();
    const msg = message ?? this.message;
    process.stderr.write(`  ${chalk.green('✔')} ${msg} ${chalk.dim(elapsed)}\n`);
  }

  fail(message?: string): void {
    this.stop();
    const elapsed = this.formatElapsed();
    const msg = message ?? this.message;
    process.stderr.write(`  ${chalk.red('✗')} ${msg} ${chalk.dim(elapsed)}\n`);
  }

  private render(): void {
    const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length];
    const elapsed = this.formatElapsed();
    process.stderr.write(`\r  ${chalk.cyan(frame)} ${this.message} ${chalk.dim(elapsed)}`);
    this.frameIndex++;
  }

  private stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.enabled) {
      process.stderr.write('\r\x1b[K'); // clear line
    }
  }

  private formatElapsed(): string {
    const ms = Date.now() - this.startTime;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
}

// ─── Node.js FileReader / FileWriter ─────────────────────────────────────────

class NodeFileReader implements ContextFileReader, PatchFileReader {
  async readFile(filePath: string): Promise<string> {
    return readFile(filePath, 'utf-8');
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dirPath, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => resolve(e.parentPath ?? '', e.name));
  }
}

class NodeFileWriter implements FileWriter {
  async writeFile(filePath: string, content: string): Promise<void> {
    await fsWriteFile(filePath, content, 'utf-8');
  }
}

// ─── Language Registry Setup ─────────────────────────────────────────────────

function createLanguageRegistry(): LanguageRegistry {
  const registry = new LanguageRegistry();
  registry.register(typescriptParser);
  registry.register(javascriptParser);
  registry.register(pythonParser);
  registry.register(javaParser);
  registry.register(goParser);
  registry.register(rustParser);
  return registry;
}

// ─── Input Reading ───────────────────────────────────────────────────────────

async function resolveInput(
  bugDescription: string | undefined,
  opts: CLIOptions,
): Promise<{ input: string; source: InputSource }> {
  if (opts.file) {
    const filePath = resolve(opts.file);
    const content = await fsReadFile(filePath, 'utf-8');
    return { input: content, source: 'file' };
  }

  if (bugDescription && bugDescription.trim().length > 0) {
    return { input: bugDescription, source: 'cli-arg' };
  }

  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const stdinContent = Buffer.concat(chunks).toString('utf-8').trim();
    if (stdinContent.length > 0) {
      return { input: stdinContent, source: 'stdin' };
    }
  }

  throw new Error(
    'No input provided.\n\n' +
      '  Usage:\n' +
      '    contextfix fix "TypeError: Cannot read property \'x\' of undefined"\n' +
      '    contextfix fix --file error.log\n' +
      '    cat error.log | contextfix fix',
  );
}

// ─── API Key Resolution ──────────────────────────────────────────────────────

function resolveApiKey(config: { apiKey?: string }, model: string): string | undefined {
  // Priority: config file > env var
  if (config.apiKey) return config.apiKey;

  const provider = model.split(':')[0];
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY;
  return process.env.OPENAI_API_KEY ?? process.env.CONTEXTFIX_API_KEY;
}

function validateApiKey(model: string, apiKey: string | undefined): void {
  const provider = model.split(':')[0];
  if (provider === 'ollama') return;

  if (!apiKey) {
    const envVar = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    process.stderr.write(`
  ${chalk.red('✗')} API key not configured for provider "${provider}".

  ${chalk.bold('Quick fix — pick one:')}

  ${chalk.dim('1.')} Environment variable:
     ${chalk.cyan(`export ${envVar}=your-api-key`)}

  ${chalk.dim('2.')} Config file (run ${chalk.cyan('contextfix init')} to create one):
     ${chalk.cyan('apiKey: your-api-key')}

  ${chalk.dim('3.')} Global config:
     ${chalk.cyan(`echo 'apiKey: your-api-key' > ~/.contextfix.yml`)}

`);
    process.exit(1);
  }
}

// ─── Base URL Resolution ─────────────────────────────────────────────────────

function resolveBaseUrl(config: { baseUrl?: string }, opts: CLIOptions): string | undefined {
  return opts.baseUrl ?? config.baseUrl ?? process.env.CONTEXTFIX_BASE_URL;
}

// ─── Pipeline Assembly ───────────────────────────────────────────────────────

function assemblePipeline(
  model: string,
  apiKey: string,
  repoPath: string,
  outputMode: OutputMode,
  baseUrl?: string,
): Pipeline {
  const llm = createLLMProvider(model, apiKey, baseUrl);
  const fileReader = new NodeFileReader();
  const fileWriter = new NodeFileWriter();

  const registry = createLanguageRegistry();
  const astParser = new ASTParser(registry);
  const gitProvider = new GitProvider(repoPath);
  const dependencyResolver = new DependencyResolver(astParser, repoPath);
  const scorer = new RelevanceScorer();

  const contextCollector = new ContextCollector(
    gitProvider, astParser, dependencyResolver, scorer, fileReader,
    llm.estimateTokens.bind(llm),
  );

  return new Pipeline({
    inputParser: new InputParser(),
    contextCollector,
    rootCauseAnalyzer: new RootCauseAnalyzer(llm),
    patchGenerator: new PatchGenerator(llm),
    outputFormatter: createFormatter(outputMode),
    patchApplier: new PatchApplier(fileReader, fileWriter),
  });
}

// ─── Output Handling ─────────────────────────────────────────────────────────

async function writeOutput(result: string, opts: CLIOptions): Promise<void> {
  if (opts.output) {
    await fsWriteFile(opts.output, result, 'utf-8');
    process.stderr.write(`\n  ${chalk.green('✔')} Output written to ${chalk.cyan(opts.output)}\n`);
  } else {
    process.stdout.write(result + '\n');
  }
}

// ─── Friendly Error Messages ─────────────────────────────────────────────────

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  // Network errors
  if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) {
    const isOllama = msg.includes('11434');
    if (isOllama) {
      return `Cannot connect to Ollama at localhost:11434.\n\n  Is Ollama running? Start it with: ${chalk.cyan('ollama serve')}`;
    }
    return `Network error — cannot reach the LLM API.\n\n  Check your internet connection and API endpoint.\n  If using a custom endpoint, verify --base-url is correct.`;
  }

  // Auth errors
  if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('Invalid API key')) {
    return `Authentication failed — your API key may be invalid or expired.\n\n  Update it with: ${chalk.cyan('contextfix init')}`;
  }

  // Rate limit
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Rate limit')) {
    return 'Rate limited by the LLM API. Wait a moment and try again.';
  }

  // Timeout
  if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
    return 'Request timed out. The LLM API may be slow or unreachable. Try again.';
  }

  return msg;
}

// ─── Command Handlers ────────────────────────────────────────────────────────

async function handleFix(
  bugDescription: string | undefined,
  opts: CLIOptions,
): Promise<void> {
  const spinner = new Spinner();
  const totalStart = Date.now();

  const { input, source } = await resolveInput(bugDescription, opts);
  const repoPath = resolve('.');

  spinner.start('Loading configuration...');
  const configManager = new ConfigManager();
  const config = await configManager.load(repoPath);
  spinner.succeed('Configuration loaded');

  const model = opts.model ?? config.model;
  const apiKey = resolveApiKey(config, model);
  const baseUrl = resolveBaseUrl(config, opts);
  validateApiKey(model, apiKey);

  const outputMode: OutputMode = opts.json ? 'json' : 'terminal';
  const pipeline = assemblePipeline(model, apiKey!, repoPath, outputMode, baseUrl);

  if (opts.verbose) {
    process.stderr.write(chalk.dim(`  Model: ${model}\n`));
    if (baseUrl) process.stderr.write(chalk.dim(`  Base URL: ${baseUrl}\n`));
    process.stderr.write(chalk.dim(`  Context limit: ${opts.contextLimit} tokens\n`));
    process.stderr.write(chalk.dim(`  Input: ${source}\n\n`));
  }

  spinner.start('Parsing input & collecting context...');
  let result: string;
  try {
    result = await pipeline.fix(input, source, {
      contextLimit: opts.contextLimit,
      repoPath,
      gitHistoryDepth: 10,
      ignorePatterns: config.ignorePatterns,
      apply: opts.apply,
      dryRun: opts.dryRun,
    });
    spinner.succeed('Analysis & patch generation complete');
  } catch (err) {
    spinner.fail('Pipeline failed');
    throw err;
  }

  const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  process.stderr.write(chalk.dim(`\n  Done in ${totalElapsed}s\n\n`));

  await writeOutput(result, opts);
}

async function handleAnalyze(
  bugDescription: string | undefined,
  opts: CLIOptions,
): Promise<void> {
  const spinner = new Spinner();
  const totalStart = Date.now();

  const { input, source } = await resolveInput(bugDescription, opts);
  const repoPath = resolve('.');

  spinner.start('Loading configuration...');
  const configManager = new ConfigManager();
  const config = await configManager.load(repoPath);
  spinner.succeed('Configuration loaded');

  const model = opts.model ?? config.model;
  const apiKey = resolveApiKey(config, model);
  const baseUrl = resolveBaseUrl(config, opts);
  validateApiKey(model, apiKey);

  const outputMode: OutputMode = opts.json ? 'json' : 'terminal';
  const pipeline = assemblePipeline(model, apiKey!, repoPath, outputMode, baseUrl);

  if (opts.verbose) {
    process.stderr.write(chalk.dim(`  Model: ${model}\n`));
    if (baseUrl) process.stderr.write(chalk.dim(`  Base URL: ${baseUrl}\n`));
    process.stderr.write(chalk.dim(`  Context limit: ${opts.contextLimit} tokens\n\n`));
  }

  spinner.start('Parsing input & analyzing root cause...');
  let result: string;
  try {
    result = await pipeline.analyze(input, source, {
      contextLimit: opts.contextLimit,
      repoPath,
      gitHistoryDepth: 10,
      ignorePatterns: config.ignorePatterns,
      apply: false,
      dryRun: false,
    });
    spinner.succeed('Root cause analysis complete');
  } catch (err) {
    spinner.fail('Analysis failed');
    throw err;
  }

  const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  process.stderr.write(chalk.dim(`\n  Done in ${totalElapsed}s\n\n`));

  await writeOutput(result, opts);
}

// ─── Init Command Handler ────────────────────────────────────────────────────

async function handleInit(): Promise<void> {
  const repoPath = resolve('.');
  const configPath = join(repoPath, '.contextfix.yml');

  try {
    await stat(configPath);
    process.stderr.write(`\n  ${chalk.yellow('!')} .contextfix.yml already exists. Edit it manually or delete it first.\n\n`);
    return;
  } catch {
    // File doesn't exist — create it
  }

  const template = `# ContextFix configuration
# Docs: https://github.com/nanami7777777/Context-Aware-Fixer

# LLM model (provider:model)
model: "openai:gpt-4"

# API key (or set OPENAI_API_KEY / ANTHROPIC_API_KEY env var)
# apiKey: "sk-..."

# Custom API endpoint for OpenAI-compatible services
# baseUrl: "https://api.openai.com/v1"

# Max context window tokens
contextLimit: 8000

# Files/directories to exclude from context collection
ignorePatterns:
  - node_modules
  - .git
  - dist
  - build
  - coverage
`;

  await fsWriteFile(configPath, template, 'utf-8');
  process.stderr.write(`\n  ${chalk.green('✔')} Created ${chalk.cyan('.contextfix.yml')}\n`);
  process.stderr.write(`\n  Next steps:\n`);
  process.stderr.write(`  ${chalk.dim('1.')} Set your API key in the config or via env var\n`);
  process.stderr.write(`  ${chalk.dim('2.')} Run ${chalk.cyan('contextfix fix "your error message"')}\n\n`);
}

// ─── Program Definition ──────────────────────────────────────────────────────

const program = new Command();

program
  .name('contextfix')
  .description('Context-aware AI bug-fixing assistant')
  .version('0.1.0');

program
  .command('init')
  .description('Create a .contextfix.yml config file in the current directory')
  .action(handleInit);

program
  .command('fix')
  .description('Analyze a bug and generate a fix patch')
  .argument('[bug-description]', 'Bug description, error message, or stack trace')
  .option('-m, --model <model>', 'AI model identifier (provider:model)', 'openai:gpt-4')
  .option('-c, --context-limit <tokens>', 'Max context window tokens', (v) => parseInt(v, 10), 8000)
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('-o, --output <file>', 'Write output to a file instead of stdout')
  .option('--apply', 'Apply the generated patch directly', false)
  .option('--dry-run', 'Preview patch changes without applying', false)
  .option('--json', 'Output in JSON format', false)
  .option('-f, --file <path>', 'Read bug description from a file')
  .option('-b, --base-url <url>', 'Custom API base URL for OpenAI-compatible endpoints')
  .action(async (bugDescription: string | undefined, cmdOpts: Record<string, unknown>) => {
    const opts: CLIOptions = {
      model: cmdOpts.model as string,
      contextLimit: cmdOpts.contextLimit as number,
      verbose: cmdOpts.verbose as boolean,
      output: (cmdOpts.output as string) ?? null,
      apply: cmdOpts.apply as boolean,
      dryRun: cmdOpts.dryRun as boolean,
      json: cmdOpts.json as boolean,
      file: cmdOpts.file as string | undefined,
      baseUrl: cmdOpts.baseUrl as string | undefined,
    };
    await handleFix(bugDescription, opts);
  });

program
  .command('analyze')
  .description('Analyze a bug without generating a patch')
  .argument('[bug-description]', 'Bug description, error message, or stack trace')
  .option('-m, --model <model>', 'AI model identifier (provider:model)', 'openai:gpt-4')
  .option('-c, --context-limit <tokens>', 'Max context window tokens', (v) => parseInt(v, 10), 8000)
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('-o, --output <file>', 'Write output to a file instead of stdout')
  .option('--json', 'Output in JSON format', false)
  .option('-f, --file <path>', 'Read bug description from a file')
  .option('-b, --base-url <url>', 'Custom API base URL for OpenAI-compatible endpoints')
  .action(async (bugDescription: string | undefined, cmdOpts: Record<string, unknown>) => {
    const opts: CLIOptions = {
      model: cmdOpts.model as string,
      contextLimit: cmdOpts.contextLimit as number,
      verbose: cmdOpts.verbose as boolean,
      output: (cmdOpts.output as string) ?? null,
      apply: false,
      dryRun: false,
      json: cmdOpts.json as boolean,
      file: cmdOpts.file as string | undefined,
      baseUrl: cmdOpts.baseUrl as string | undefined,
    };
    await handleAnalyze(bugDescription, opts);
  });

// ─── Error Handling & Execution ──────────────────────────────────────────────

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = friendlyError(err);
  process.stderr.write(`\n  ${chalk.red('✗')} ${message}\n\n`);
  process.exit(1);
});

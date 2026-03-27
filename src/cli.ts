// ContextFix CLI — main entry point

import { Command } from 'commander';
import { readFile as fsReadFile, writeFile as fsWriteFile, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

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

// ─── Node.js FileReader for ContextCollector ─────────────────────────────────

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

// ─── Node.js FileWriter for PatchApplier ─────────────────────────────────────

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

/**
 * Read bug description input from one of three sources:
 * 1. CLI argument (the <bug-description> positional arg)
 * 2. --file <path> option
 * 3. stdin (when piped)
 */
async function resolveInput(
  bugDescription: string | undefined,
  opts: CLIOptions,
): Promise<{ input: string; source: InputSource }> {
  // 1. --file option takes priority
  if (opts.file) {
    const filePath = resolve(opts.file);
    const content = await fsReadFile(filePath, 'utf-8');
    return { input: content, source: 'file' };
  }

  // 2. CLI argument
  if (bugDescription && bugDescription.trim().length > 0) {
    return { input: bugDescription, source: 'cli-arg' };
  }

  // 3. stdin (only when piped, not interactive TTY)
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
    'No input provided. Pass a bug description as an argument, use --file <path>, or pipe via stdin.\n' +
      'Examples:\n' +
      '  contextfix fix "TypeError: Cannot read property \'x\' of undefined"\n' +
      '  contextfix fix --file error.log\n' +
      '  cat error.log | contextfix fix',
  );
}

// ─── API Key Validation ──────────────────────────────────────────────────────

function validateApiKey(model: string, apiKey: string | undefined): void {
  const provider = model.split(':')[0];

  // Ollama doesn't need an API key
  if (provider === 'ollama') return;

  if (!apiKey) {
    const envVarName =
      provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';

    console.error(`\n  ✗ API key not configured for provider "${provider}".\n`);
    console.error('  Configure your API key using one of these methods:\n');
    console.error(`  1. Set the environment variable:`);
    console.error(`     export ${envVarName}=your-api-key\n`);
    console.error(`  2. Add it to your project config (.contextfix.yml):`);
    console.error(`     apiKey: your-api-key\n`);
    console.error(`  3. Add it to your global config (~/.contextfix.yml):`);
    console.error(`     apiKey: your-api-key\n`);
    process.exit(1);
  }
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
    gitProvider,
    astParser,
    dependencyResolver,
    scorer,
    fileReader,
    llm.estimateTokens.bind(llm),
  );

  const rootCauseAnalyzer = new RootCauseAnalyzer(llm);
  const patchGenerator = new PatchGenerator(llm);
  const patchApplier = new PatchApplier(fileReader, fileWriter);
  const outputFormatter = createFormatter(outputMode);

  return new Pipeline({
    inputParser: new InputParser(),
    contextCollector,
    rootCauseAnalyzer,
    patchGenerator,
    outputFormatter,
    patchApplier,
  });
}

// ─── Output Handling ─────────────────────────────────────────────────────────

async function writeOutput(result: string, opts: CLIOptions): Promise<void> {
  if (opts.output) {
    await fsWriteFile(opts.output, result, 'utf-8');
    if (opts.verbose) {
      console.error(`Output written to ${opts.output}`);
    }
  } else {
    process.stdout.write(result + '\n');
  }
}

// ─── Command Handlers ────────────────────────────────────────────────────────

async function handleFix(
  bugDescription: string | undefined,
  opts: CLIOptions,
): Promise<void> {
  const { input, source } = await resolveInput(bugDescription, opts);
  const repoPath = resolve('.');

  const configManager = new ConfigManager();
  const config = await configManager.load(repoPath);

  const model = opts.model ?? config.model;
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';

  validateApiKey(model, apiKey || undefined);

  const outputMode: OutputMode = opts.json ? 'json' : 'terminal';
  const pipeline = assemblePipeline(model, apiKey, repoPath, outputMode, opts.baseUrl);

  if (opts.verbose) {
    console.error(`Model: ${model}`);
    if (opts.baseUrl) console.error(`Base URL: ${opts.baseUrl}`);
    console.error(`Context limit: ${opts.contextLimit}`);
    console.error(`Input source: ${source}`);
    console.error(`Apply: ${opts.apply}, Dry-run: ${opts.dryRun}`);
  }

  const result = await pipeline.fix(input, source, {
    contextLimit: opts.contextLimit,
    repoPath,
    gitHistoryDepth: 10,
    ignorePatterns: config.ignorePatterns,
    apply: opts.apply,
    dryRun: opts.dryRun,
  });

  await writeOutput(result, opts);
}

async function handleAnalyze(
  bugDescription: string | undefined,
  opts: CLIOptions,
): Promise<void> {
  const { input, source } = await resolveInput(bugDescription, opts);
  const repoPath = resolve('.');

  const configManager = new ConfigManager();
  const config = await configManager.load(repoPath);

  const model = opts.model ?? config.model;
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';

  validateApiKey(model, apiKey || undefined);

  const outputMode: OutputMode = opts.json ? 'json' : 'terminal';
  const pipeline = assemblePipeline(model, apiKey, repoPath, outputMode, opts.baseUrl);

  if (opts.verbose) {
    console.error(`Model: ${model}`);
    if (opts.baseUrl) console.error(`Base URL: ${opts.baseUrl}`);
    console.error(`Context limit: ${opts.contextLimit}`);
    console.error(`Input source: ${source}`);
  }

  const result = await pipeline.analyze(input, source, {
    contextLimit: opts.contextLimit,
    repoPath,
    gitHistoryDepth: 10,
    ignorePatterns: config.ignorePatterns,
    apply: false,
    dryRun: false,
  });

  await writeOutput(result, opts);
}

// ─── Program Definition ──────────────────────────────────────────────────────

const program = new Command();

program
  .name('contextfix')
  .description('Context-aware AI bug-fixing assistant')
  .version('0.1.0');

program
  .command('fix')
  .description('Analyze a bug and generate a fix patch')
  .argument('[bug-description]', 'Bug description, error message, or stack trace')
  .option('-m, --model <model>', 'AI model identifier (provider:model)', 'openai:gpt-4')
  .option('-c, --context-limit <tokens>', 'Maximum context window tokens', (v) => parseInt(v, 10), 8000)
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
  .option('-c, --context-limit <tokens>', 'Maximum context window tokens', (v) => parseInt(v, 10), 8000)
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
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
});

// Interactive Mode — Chat-based REPL for iterative bug fixing

import * as readline from 'node:readline';
import chalk from 'chalk';
import type { LLMProvider } from './llm/provider.js';
import type { ChatMessage } from './types.js';

export interface InteractiveOptions {
  llm: LLMProvider;
  repoPath: string;
  verbose: boolean;
}

/**
 * Run an interactive chat session for iterative bug analysis.
 * The user can ask follow-up questions, request different files,
 * or refine the fix approach.
 */
export async function runInteractive(opts: InteractiveOptions): Promise<void> {
  const { llm, repoPath } = opts;
  const history: ChatMessage[] = [];

  const systemMessage: ChatMessage = {
    role: 'system',
    content: `You are ContextFix, an expert AI bug-fixing assistant. You are helping a developer debug and fix issues in their codebase at: ${repoPath}

You can:
- Analyze error messages and stack traces
- Identify root causes with confidence levels
- Suggest fixes with unified diff patches
- Explain code behavior and potential issues

Be concise and actionable. When suggesting fixes, use unified diff format.
When analyzing, rank candidates by confidence.`,
  };

  history.push(systemMessage);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: chalk.cyan('contextfix> '),
    terminal: true,
  });

  process.stderr.write('\n');
  process.stderr.write(chalk.bold('  ContextFix Interactive Mode\n'));
  process.stderr.write(chalk.dim('  Type your bug description, error, or follow-up question.\n'));
  process.stderr.write(chalk.dim('  Commands: /clear (reset), /history (show), /quit (exit)\n'));
  process.stderr.write('\n');

  rl.prompt();

  for await (const line of rl) {
    const trimmed = line.trim();

    if (!trimmed) {
      rl.prompt();
      continue;
    }

    // Handle slash commands
    if (trimmed === '/quit' || trimmed === '/exit' || trimmed === '/q') {
      process.stderr.write(chalk.dim('\n  Bye.\n\n'));
      rl.close();
      return;
    }

    if (trimmed === '/clear') {
      history.length = 1; // keep system message
      process.stderr.write(chalk.dim('  Conversation cleared.\n\n'));
      rl.prompt();
      continue;
    }

    if (trimmed === '/history') {
      const userMsgs = history.filter(m => m.role !== 'system');
      if (userMsgs.length === 0) {
        process.stderr.write(chalk.dim('  No messages yet.\n\n'));
      } else {
        for (const msg of userMsgs) {
          const prefix = msg.role === 'user' ? chalk.cyan('you: ') : chalk.green('ai:  ');
          const content = msg.content.length > 80 ? msg.content.slice(0, 80) + '...' : msg.content;
          process.stderr.write(`  ${prefix}${content}\n`);
        }
        process.stderr.write('\n');
      }
      rl.prompt();
      continue;
    }

    // Send message to LLM
    history.push({ role: 'user', content: trimmed });

    process.stderr.write('\n');

    let fullResponse = '';
    try {
      for await (const chunk of llm.chat(history, {
        temperature: 0.3,
        maxTokens: 4096,
        stream: true,
      })) {
        process.stdout.write(chunk);
        fullResponse += chunk;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(chalk.red(`  Error: ${msg}\n`));
      // Remove the failed user message
      history.pop();
      process.stderr.write('\n');
      rl.prompt();
      continue;
    }

    process.stdout.write('\n\n');
    history.push({ role: 'assistant', content: fullResponse });

    rl.prompt();
  }
}

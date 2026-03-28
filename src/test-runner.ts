// Test Runner — Detects and runs project tests to verify patches

import { exec } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Result of running project tests */
export interface TestResult {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

/** Detect the test command for a project by checking config files */
export async function detectTestCommand(repoPath: string): Promise<string | null> {
  // Check package.json for npm/pnpm/yarn projects
  try {
    const pkgPath = join(repoPath, 'package.json');
    await stat(pkgPath);
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    if (pkg.scripts?.test) {
      // Detect package manager
      const pm = await detectPackageManager(repoPath);
      return `${pm} test`;
    }
  } catch { /* no package.json */ }

  // Check for pytest (Python)
  try {
    await stat(join(repoPath, 'pyproject.toml'));
    return 'python -m pytest --tb=short -q';
  } catch { /* no pyproject.toml */ }

  try {
    await stat(join(repoPath, 'setup.py'));
    return 'python -m pytest --tb=short -q';
  } catch { /* no setup.py */ }

  // Check for Go
  try {
    await stat(join(repoPath, 'go.mod'));
    return 'go test ./...';
  } catch { /* no go.mod */ }

  // Check for Cargo (Rust)
  try {
    await stat(join(repoPath, 'Cargo.toml'));
    return 'cargo test';
  } catch { /* no Cargo.toml */ }

  // Check for Maven (Java)
  try {
    await stat(join(repoPath, 'pom.xml'));
    return 'mvn test -q';
  } catch { /* no pom.xml */ }

  // Check for Gradle (Java)
  try {
    await stat(join(repoPath, 'build.gradle'));
    return 'gradle test';
  } catch { /* no build.gradle */ }

  return null;
}

/** Detect the package manager (pnpm > yarn > npm) */
async function detectPackageManager(repoPath: string): Promise<string> {
  try {
    await stat(join(repoPath, 'pnpm-lock.yaml'));
    return 'pnpm';
  } catch { /* not pnpm */ }

  try {
    await stat(join(repoPath, 'yarn.lock'));
    return 'yarn';
  } catch { /* not yarn */ }

  try {
    await stat(join(repoPath, 'bun.lockb'));
    return 'bun';
  } catch { /* not bun */ }

  return 'npm';
}

/** Run a test command and return the result */
export function runTests(command: string, repoPath: string, timeoutMs = 120_000): Promise<TestResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    const child = exec(command, {
      cwd: repoPath,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 5, // 5MB
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
    }, (error, stdout, stderr) => {
      const duration = Date.now() - start;
      const exitCode = error?.code ?? (error ? 1 : 0);

      resolve({
        success: exitCode === 0,
        command,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: typeof exitCode === 'number' ? exitCode : 1,
        duration,
      });
    });
  });
}

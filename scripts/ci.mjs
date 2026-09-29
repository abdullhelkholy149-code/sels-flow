#!/usr/bin/env node
/**
 * Local CI entry point: runs the exact same chain as the GitHub workflow.
 * Any failing step stops the run with a non zero exit code.
 */
import { spawnSync } from 'node:child_process';

const steps = [
  ['typecheck', ['run', 'typecheck']],
  ['lint', ['run', 'lint']],
  ['format:check', ['run', 'format:check']],
  ['unit tests', ['run', 'test']],
];

const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

let failed = false;

for (const [label, args] of steps) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(npm, args, { stdio: 'inherit', shell: isWindows });

  if (result.status !== 0) {
    process.stderr.write(`\n[ci] step failed: ${label}\n`);
    failed = true;
    break;
  }
}

if (failed) {
  process.exit(1);
}

process.stdout.write('\n[ci] all steps passed\n');

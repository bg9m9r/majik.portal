#!/usr/bin/env node
// Build-time version stamp. Rewrites the `commitSha` / `buildTime` literals
// in the environment files so the built bundle carries the git SHA + build
// timestamp (consumed by the in-app issue-report telemetry). Idempotent:
// safe to run repeatedly; re-stamps to the current values each time.
//
// Wired as the `prebuild` npm hook so `npm run build` always stamps. Dev
// serve does NOT run prebuild, so the dev bundle keeps `commitSha: 'dev'`.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

function gitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repoRoot })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

const sha = gitSha();
const buildTime = new Date().toISOString();

const files = [
  join(repoRoot, 'src/environments/environment.ts'),
  join(repoRoot, 'src/environments/environment.production.ts'),
];

for (const file of files) {
  let src = readFileSync(file, 'utf8');
  // Replace the existing literal regardless of its current value (idempotent).
  src = src.replace(/commitSha:\s*'[^']*'/, `commitSha: '${sha}'`);
  src = src.replace(/buildTime:\s*'[^']*'/, `buildTime: '${buildTime}'`);
  writeFileSync(file, src);
  console.log(`stamped ${file} → commitSha='${sha}' buildTime='${buildTime}'`);
}

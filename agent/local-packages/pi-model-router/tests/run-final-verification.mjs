// Evidence runner only; does not change production/configuration files.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const agent = '/Users/liyi/.pi/agent';
const pi = '/Users/liyi/n/lib/node_modules/@earendil-works/pi-coding-agent';
function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
const inputs = [
  ...filesUnder(path.join(root, 'src')), ...filesUnder(path.join(root, 'docs')),
  path.join(root, 'package.json'), path.join(root, 'README.md'),
  ...filesUnder(path.join(root, 'tests')).filter(p => p.endsWith('.mjs')),
  `${agent}/settings.json`, `${agent}/backups/model-router-20260914/settings.before.json`,
  `${agent}/models-store.json`, `${agent}/extensions/model-router/index.ts`,
  `${pi}/package.json`, `${pi}/dist/core/extensions/loader.js`,
  `${pi}/node_modules/@earendil-works/pi-ai/dist/models.js`,
].sort();
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const snapshot = () => Object.fromEntries(inputs.map(file => [file, hash(file)]));
const before = snapshot();
const startedAt = new Date().toISOString();
const command = 'node --experimental-strip-types --test tests/*.test.mjs';
const result = spawnSync('/bin/bash', ['-c', command], {
  cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
});
const tapPath = path.join(root, 'tests/final.tap');
fs.writeFileSync(tapPath, result.stdout + result.stderr);
const after = snapshot();
const changedFiles = inputs.filter(file => before[file] !== after[file]);
const evidence = {
  startedAt, finishedAt: new Date().toISOString(), cwd: root,
  node: process.version, nodeExecutable: process.execPath,
  piVersion: JSON.parse(fs.readFileSync(`${pi}/package.json`, 'utf8')).version,
  command, exitCode: result.status, signal: result.signal,
  executionError: result.error?.message ?? null,
  changedFiles, before, after,
  tap: { path: tapPath, sha256: hash(tapPath), bytes: fs.statSync(tapPath).size },
};
fs.writeFileSync(path.join(root, 'tests/final-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ command, exitCode: result.status, changedFiles, node: process.version }));
console.log(result.stdout.split('\n').slice(-12).join('\n'));
process.exitCode = result.status === 0 && changedFiles.length === 0 && !result.error ? 0 : 1;

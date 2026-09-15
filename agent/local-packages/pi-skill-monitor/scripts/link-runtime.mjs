// Reuse an already installed Pi for local tests; installs nothing globally.
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pi = process.argv[2];
if (!pi) throw new Error('Usage: node scripts/link-runtime.mjs /absolute/path/to/installed/pi-coding-agent');
for (const [name, target] of [
  ['@earendil-works/pi-coding-agent', resolve(pi)],
  ['@earendil-works/pi-tui', resolve(pi, 'node_modules/@earendil-works/pi-tui')],
  ['@types/node', resolve(pi, 'node_modules/@types/node')],
]) {
  if (!existsSync(resolve(target, 'package.json'))) throw new Error(`Missing installed package: ${target}`);
  const link = resolve(root, 'node_modules', name);
  mkdirSync(dirname(link), { recursive: true });
  if (!existsSync(link)) symlinkSync(target, link, 'dir');
}
console.log('Linked installed Pi runtime for local development; no packages installed.');

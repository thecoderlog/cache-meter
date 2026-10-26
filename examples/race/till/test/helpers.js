// What the tests share (docs/architecture.md › Tests).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { loadCatalog } from '../src/catalog.js';

export const dataFile = name => fileURLToPath(new URL(`../data/${name}`, import.meta.url));

// Runs the CLI in-process, the way `till ...argv` would → { code, stdout, stderr }
export function run(...argv) {
  let stdout = '';
  let stderr = '';
  const io = {
    stdout: { write: text => { stdout += text; } },
    stderr: { write: text => { stderr += text; } },
  };
  const code = main(argv, io);
  return { code, stdout, stderr };
}

let dir;
// Writes `text` to a throwaway file and returns its path. The files go when the test process ends.
export function tempFile(name, text) {
  if (!dir) {
    dir = mkdtempSync(join(tmpdir(), 'till-test-'));
    process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  }
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

// cartText(['1004', 2], ['1005', 1]) → 'sku,qty\n1004,2\n1005,1\n'
export function cartText(...rows) {
  return ['sku,qty', ...rows.map(([sku, qty]) => `${sku},${qty}`)].join('\n') + '\n';
}

export function sampleCatalog() {
  return loadCatalog(dataFile('catalog.csv'));
}

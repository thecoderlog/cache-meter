// What the examples share: the model, the till (the big shared context), and a results folder.
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { binder } from './binder.mjs';

export const MODEL = 'claude-sonnet-5-5';
export const TILL = fileURLToPath(new URL('./race/till/', import.meta.url));

// A new id for every run, at the very top of the prompt: no run can read what another one cached
export const newRunId = () => randomBytes(4).toString('hex');

// The till, every file of it, under a first line that names the run
export function tillPrompt(runId, intro) {
  return `Run ${runId}\n\n${intro}\n\n${binder(TILL).text}`;
}

export function option(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

// results/<name>-<time>/, or --out
export function outDir(name) {
  const dir = resolve(option('--out', join('results', `${name}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`)));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const sleep = ms => new Promise(done => setTimeout(done, ms));

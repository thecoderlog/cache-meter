// Reading the till's input files. A file that's missing or can't be parsed is a TillError that names
// the file, so the person at the counter knows which one to fix.
import { readFileSync } from 'node:fs';
import { TillError } from './errors.js';

export function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new TillError(`no such file: ${path}`);
    if (err.code === 'EISDIR') throw new TillError(`${path} is a folder, not a file`);
    throw new TillError(`cannot read ${path} (${err.code || err.message})`);
  }
}

export function readJson(path) {
  const text = readText(path);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new TillError(`${path} is not valid JSON (${err.message})`);
  }
}

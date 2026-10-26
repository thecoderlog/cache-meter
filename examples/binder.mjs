// The binder: a whole folder of text files as one block of text for a system prompt, every file in a
// <file path="..."> tag. The order is fixed (README first, then the other top-level files, docs, src, test,
// data, the rest; by path inside each), so the same folder always gives the same bytes. That matters: a cache
// only hits on a prefix that's exactly the same, byte for byte.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

const SKIP = new Set(['node_modules', '.git', '.DS_Store']);
const ORDER = ['README.md', '<top>', 'docs', 'src', 'test', 'data'];

function files(dir, root = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path, root));
    else out.push(relative(root, path).split(sep).join('/'));
  }
  return out;
}

function rank(path) {
  if (path === 'README.md') return 0;
  if (!path.includes('/')) return 1;
  const i = ORDER.indexOf(path.split('/')[0]);
  return i === -1 ? ORDER.length : i;
}

// → { text, files: [paths in order], bytes }
export function binder(dir, { name = basename(dir) } = {}) {
  const paths = files(dir).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  const parts = [`<repository name="${name}">`];
  for (const path of paths) {
    const text = readFileSync(join(dir, path), 'utf8');
    if (text.includes('\0')) continue; // not a text file
    parts.push(`<file path="${path}">\n${text.endsWith('\n') ? text : text + '\n'}</file>`);
  }
  parts.push('</repository>');
  const text = parts.join('\n');
  return { text, files: paths, bytes: Buffer.byteLength(text) };
}

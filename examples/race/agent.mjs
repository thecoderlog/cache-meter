// The race agent: a plain Messages API tool loop that works on a copy of the till. The whole repo goes in the
// system prompt (the binder) and three tools let the model read, edit and run things. Both sides of the race
// run this file; the only difference is --cache on, which adds the two lines marked CACHE.
//
//   node agent.mjs <repo folder> "<task>" [--cache on|off]
import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { meter } from '../../cache-meter.mjs';
import { binder } from '../binder.mjs';

export const MODEL = 'claude-sonnet-5-5';
export const MAX_TURNS = 40;

const RULES = `You are a coding agent working on the till repository, a small Node.js command-line app. Every file in
the repository is below, as it was when the task started. Use read_file to see a file again after you've
changed it, edit_file to change files, and bash to run commands in the repository (npm test runs the tests).
Work in small steps and run the tests. When the task is done and npm test passes, stop calling tools and
reply with a two-line summary of what you changed.`;

const TOOLS = [
  {
    name: 'read_file',
    description: 'Read a file in the repository. Returns its text.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path from the repository root, like src/cli.js' } },
      required: ['path'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Change a file: old_text is replaced by new_text, and old_text must appear in the file exactly once. ' +
      'With an empty old_text, new_text becomes the whole file (for a new file, or to rewrite one).',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path from the repository root' },
        old_text: { type: 'string', description: 'The exact text to replace, or empty to write the whole file' },
        new_text: { type: 'string', description: 'The text to put in its place' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'bash',
    description: 'Run a shell command in the repository root, such as npm test. 60-second limit. Returns the exit code and the output.',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'The command line to run' } },
      required: ['command'],
    },
  },
];

// The system prompt: a line that's new for every run (so each run starts with nothing in the cache, and no
// run can read what another one wrote), the rules, then the whole repo.
export function systemPrompt(dir, runId) {
  return `Run ${runId}\n\n${RULES}\n\n${binder(dir).text}`;
}

// Runs the task to the end → { turns, stop, summary, ms }. `client` is a metered Anthropic client.
export async function runAgent({ dir, task, cache, client, runId = randomBytes(4).toString('hex'), maxTurns = MAX_TURNS, maxUsd = Infinity }) {
  const system = [{ type: 'text', text: systemPrompt(dir, runId) }];
  if (cache) system[0].cache_control = { type: 'ephemeral' }; // CACHE 1: the repo, written once and read back every turn
  const messages = [{ role: 'user', content: task }];
  const started = Date.now();
  for (let turn = 1; turn <= maxTurns; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      tools: TOOLS,
      messages,
      ...(cache && { cache_control: { type: 'ephemeral' } }), // CACHE 2: the conversation so far, moved forward every turn
    });
    messages.push({ role: 'assistant', content: response.content });
    const calls = response.content.filter(block => block.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || calls.length === 0) {
      const summary = response.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
      return { turns: turn, stop: response.stop_reason, summary, ms: Date.now() - started, messages };
    }
    const results = [];
    for (const call of calls) {
      const { text, isError } = await runTool(dir, call);
      results.push({ type: 'tool_result', tool_use_id: call.id, content: text, ...(isError && { is_error: true }) });
    }
    messages.push({ role: 'user', content: results });
    if (client.meter && client.meter.spent() > maxUsd) {
      return { turns: turn, stop: 'budget', summary: `stopped: the run passed $${maxUsd}`, ms: Date.now() - started, messages };
    }
  }
  return { turns: maxTurns, stop: 'max_turns', summary: `stopped after ${maxTurns} turns`, ms: Date.now() - started, messages };
}

// ------------------------------------------------------------------ the tools
function inside(dir, path) {
  const full = resolve(dir, String(path ?? ''));
  if (full !== resolve(dir) && !full.startsWith(resolve(dir) + sep)) throw new Error(`${path} is outside the repository`);
  return full;
}

async function runTool(dir, call) {
  try {
    const input = call.input ?? {};
    if (call.name === 'read_file') {
      const full = inside(dir, input.path);
      if (!existsSync(full)) return { text: `no such file: ${input.path}`, isError: true };
      return { text: clip(readFileSync(full, 'utf8')) || '(empty file)' };
    }
    if (call.name === 'edit_file') {
      const full = inside(dir, input.path);
      const oldText = input.old_text ?? '';
      const newText = input.new_text ?? '';
      if (oldText === '') {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, newText);
        return { text: `wrote ${input.path} (${newText.split('\n').length} lines)` };
      }
      if (!existsSync(full)) return { text: `no such file: ${input.path}`, isError: true };
      const text = readFileSync(full, 'utf8');
      const count = text.split(oldText).length - 1;
      if (count !== 1) {
        return { text: `old_text appears ${count} times in ${input.path}; it must appear exactly once (add more of the lines around it)`, isError: true };
      }
      writeFileSync(full, text.replace(oldText, () => newText));
      return { text: `edited ${input.path}` };
    }
    if (call.name === 'bash') return await bash(dir, String(input.command ?? ''));
    return { text: `no tool called ${call.name}`, isError: true };
  } catch (err) {
    return { text: String(err.message || err), isError: true };
  }
}

// The shell gets the repo as its folder and an environment without the API key
function bash(dir, command) {
  const env = { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' };
  for (const name of Object.keys(env)) if (/^(ANTHROPIC_|CACHE_METER_|W15_)/.test(name)) delete env[name];
  return new Promise(done => {
    const child = spawn('bash', ['-c', command], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { out += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const head = signal === 'SIGKILL' ? 'stopped after 60 seconds' : `exit code ${code}`;
      done({ text: `${head}\n${clip(out, 12_000)}`.trimEnd(), isError: code !== 0 });
    });
  });
}

// Long output keeps its start and its end (where test failures and summaries are)
function clip(text, max = 40_000) {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n… ${text.length - max} characters left out …\n${text.slice(-half)}`;
}

// ------------------------------------------------------------------ on its own
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, task, ...rest] = process.argv.slice(2);
  const flag = rest.indexOf('--cache');
  const cache = flag !== -1 && rest[flag + 1] === 'on';
  if (!dir || !task) {
    console.error('usage: node agent.mjs <repo folder> "<task>" [--cache on|off]');
    process.exit(2);
  }
  const client = meter(new Anthropic(), { label: cache ? 'B cached' : 'A no cache', color: cache ? 'purple' : 'teal', notes: true, clock: true });
  const result = await runAgent({ dir: resolve(dir), task, cache, client });
  console.log(`\n${result.summary}\n\n${result.turns} turns, stopped on ${result.stop}`);
  client.meter.printSummary();
}

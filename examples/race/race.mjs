// The race: the same agent on the same task, side A with caching off and side B with it on, one run at a time,
// round after round, the sides taking turns to go first. Every run gets a fresh copy of the till and the hidden
// checks at the end.
//
//   node race.mjs [--runs 5] [--out <folder>] [--max-usd 30] [--max-usd-per-run 6]
//
// The headline number is the cost per passing run: what a side spent, over the runs that passed.
import Anthropic from '@anthropic-ai/sdk';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { meter, fmt, usd } from '../../cache-meter.mjs';
import { MODEL, runAgent } from './agent.mjs';

export const TASK = 'Add Till Club loyalty points (the --card flag) as described in docs/loyalty.md. Add tests.';
const TILL = fileURLToPath(new URL('./till/', import.meta.url));
const CHECK = fileURLToPath(new URL('./check.mjs', import.meta.url));
const SIDES = [
  { key: 'A', label: 'A no cache', color: 'teal', cache: false },
  { key: 'B', label: 'B cached', color: 'purple', cache: true },
];

function option(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const RUNS = Number(option('--runs', 5));
const OUT = resolve(option('--out', join('race-results', new Date().toISOString().replace(/[:.]/g, '-'))));
const MAX_USD = Number(option('--max-usd', 30));
const MAX_PER_RUN = Number(option('--max-usd-per-run', 6));
const WORK = mkdtempSync(join(tmpdir(), 'cache-meter-race-'));

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (color, text) => (tty ? `\x1b[38;5;${color === 'teal' ? 37 : 141}m${text}\x1b[0m` : text);
const bold = text => (tty ? `\x1b[1m${text}\x1b[0m` : text);
const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

function git(dir, ...args) {
  return spawnSync('git', ['-c', 'user.name=race', '-c', 'user.email=race@example.com', '-c', 'core.pager=cat', ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
}

// A fresh copy of the till with its own git history, so the diff afterwards is exactly what the agent did
function freshTill(name) {
  const dir = join(WORK, name);
  cpSync(TILL, dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'till 0.9.0');
  return dir;
}

function check(dir) {
  return new Promise(done => {
    const child = spawn(process.execPath, [CHECK, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { out += chunk; });
    child.on('close', code => {
      const json = out.split('\n').find(l => l.startsWith('JSON '));
      const last = out.trim().split('\n').at(-1) ?? '';
      done({ pass: code === 0, last, checks: json ? JSON.parse(json.slice(5)).checks : [], text: out });
    });
  });
}

async function runSide(side, round) {
  const name = `r${round}-${side.key}`;
  const dir = freshTill(name);
  const client = meter(new Anthropic({ maxRetries: 4 }), {
    label: side.label,
    color: side.color,
    notes: true,
    clock: true,
    log: join(OUT, 'calls.jsonl'),
  });
  const runId = `${name}-${Math.random().toString(16).slice(2, 10)}`;
  let result;
  try {
    result = await runAgent({ dir, task: TASK, cache: side.cache, client, runId, maxUsd: MAX_PER_RUN });
  } catch (err) {
    result = { turns: client.meter.calls.length, stop: `error: ${err.message}`, summary: '', ms: Date.now() - client.meter.startedAt };
  }
  const checked = await check(dir);
  git(dir, 'add', '-A');
  const diff = git(dir, 'diff', '--cached').stdout;
  const stat = git(dir, 'diff', '--cached', '--shortstat').stdout.trim();
  mkdirSync(join(OUT, 'diffs'), { recursive: true });
  writeFileSync(join(OUT, 'diffs', `${name}.diff`), diff);
  writeFileSync(join(OUT, 'checks', `${name}.txt`), checked.text);
  const s = client.meter.summary();
  const run = {
    side: side.key,
    label: side.label,
    cache: side.cache,
    round,
    run_id: runId,
    dir,
    turns: result.turns,
    stop: result.stop,
    ms: result.ms,
    agent_summary: result.summary,
    pass: checked.pass,
    check: checked.last,
    checks: checked.checks,
    diffstat: stat,
    meter: s,
  };
  const lines = [
    '',
    `${paint(side.color, bold(side.label.padEnd(10)))}  round ${round}: ${result.turns} turns in ${clock(result.ms)}, ${usd(s.spent)}` +
      (result.stop === 'end_turn' ? '' : `, stopped: ${result.stop}`),
    ...checked.text.split('\n').filter(l => /^[✓✗]/.test(l)).map(l => '   ' + l),
    `   ${checked.pass ? bold(checked.last) : checked.last}`,
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');
  return run;
}

function scoreboard(runs) {
  const col = side => runs.filter(run => run.side === side.key);
  const stats = SIDES.map(side => {
    const mine = col(side);
    const passed = mine.filter(run => run.pass).length;
    const spent = mine.reduce((total, run) => total + run.meter.spent, 0);
    const t = { input: 0, write: 0, read: 0, output: 0 };
    let withCacheEstimate = 0;
    let estimated = true;
    for (const run of mine) {
      t.input += run.meter.tokens.input;
      t.write += run.meter.tokens.write5m + run.meter.tokens.write1h;
      t.read += run.meter.tokens.read;
      t.output += run.meter.tokens.output;
      if (run.meter.with_cache_estimate === null) estimated = false;
      else withCacheEstimate += run.meter.with_cache_estimate;
    }
    const prompt = t.input + t.write + t.read;
    return {
      side: side.key,
      label: side.label,
      runs: mine.length,
      passed,
      median_seconds: median(mine.map(run => run.ms / 1000)),
      median_turns: median(mine.map(run => run.turns)),
      tokens: t,
      hit_rate: prompt ? t.read / prompt : 0,
      spent: Math.round(spent * 1e6) / 1e6,
      cost_per_passing_run: passed ? Math.round((spent / passed) * 1e6) / 1e6 : null,
      without_cache: Math.round(mine.reduce((total, run) => total + run.meter.without_cache, 0) * 1e6) / 1e6,
      with_cache_estimate: estimated && mine.length ? Math.round(withCacheEstimate * 1e6) / 1e6 : null,
    };
  });
  const [a, b] = stats;
  const row = (name, f) => `${name.padEnd(24)}${String(f(a)).padEnd(18)}${f(b)}`;
  const lines = [
    `The race: ${Math.max(a.runs, b.runs)} round${Math.max(a.runs, b.runs) === 1 ? '' : 's'} on ${MODEL}`,
    `Task: ${TASK}`,
    '',
    row('', s => s.label),
    row('passed', s => `${s.passed} of ${s.runs}`),
    row('median time', s => (s.median_seconds === null ? '-' : clock(s.median_seconds * 1000))),
    row('median turns', s => s.median_turns ?? '-'),
    row('input at full price', s => fmt(s.tokens.input)),
    row('cache writes', s => fmt(s.tokens.write)),
    row('cache reads', s => fmt(s.tokens.read)),
    row('hit rate', s => `${(s.hit_rate * 100).toFixed(1)}%`),
    row('output tokens', s => fmt(s.tokens.output)),
    row('spent', s => usd(s.spent)),
    row('cost per passing run', s => (s.cost_per_passing_run === null ? 'none passed' : usd(s.cost_per_passing_run))),
  ];
  if (a.cost_per_passing_run && b.cost_per_passing_run) {
    lines.push('', `B costs ${(a.cost_per_passing_run / b.cost_per_passing_run).toFixed(1)}x less per passing run.`);
  }
  if (a.with_cache_estimate !== null && a.spent > 0) {
    lines.push(`cache-meter's estimate for A with caching on: ${usd(a.with_cache_estimate)}, ` +
      `${(((a.spent - a.with_cache_estimate) / a.spent) * 100).toFixed(0)}% less than A spent.`);
  }
  return { stats, text: lines.join('\n') };
}

async function main() {
  mkdirSync(join(OUT, 'checks'), { recursive: true });
  console.log(`The race: ${RUNS} round${RUNS === 1 ? '' : 's'}, ${SIDES.map(s => paint(s.color, s.label)).join(' against ')}, ` +
    'one run at a time, taking turns to go first.');
  console.log(`Task: ${TASK}\n`);
  const runs = [];
  let spent = 0;
  race: for (let round = 1; round <= RUNS; round++) {
    console.log(bold(`Round ${round} of ${RUNS}`));
    for (const side of round % 2 ? SIDES : [...SIDES].reverse()) {
      if (spent > MAX_USD) {
        console.log(`Stopping: the race has cost ${usd(spent)}, over the ${usd(MAX_USD)} limit.`);
        break race;
      }
      runs.push(await runSide(side, round));
      spent = runs.reduce((total, run) => total + run.meter.spent, 0);
      writeFileSync(join(OUT, 'result.json'), JSON.stringify({ task: TASK, model: MODEL, runs, ...scoreboard(runs) }, null, 2));
    }
  }
  const board = scoreboard(runs);
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ task: TASK, model: MODEL, work: WORK, runs, ...board }, null, 2));
  writeFileSync(join(OUT, 'scoreboard.txt'), board.text + '\n');
  console.log('\n' + board.text);
  console.log(`\nResults: ${OUT}`);
}

await main();

// Test 3: Batch on top. The same review prompt over 20 files of the till, with the whole till in the system
// prompt, five ways:
//
//   A  one call at a time, no caching
//   B  one call at a time, cached (the first call writes, the other 19 read)
//   C  one batch, no caching (Batch: half price on everything)
//   D  one batch, cached for an hour (cache hits inside a batch are best-effort)
//   E  one batch, cached for an hour, with the cache warmed first by a normal call with max_tokens 0
//
//   node examples/batch.mjs submit     send batches C, D and E (they can take up to an hour)
//   node examples/batch.mjs normal     run lanes A and B
//   node examples/batch.mjs collect    wait for the batches, then the table
//   node examples/batch.mjs all        all three, one after the other
//   --files <n>                        review only the first n files (default 20)
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { meter, usd } from '../cache-meter.mjs';
import { MODEL, newRunId, option, sleep, tillPrompt } from './shared.mjs';

const FILES = [
  'src/args.js', 'src/bill.js', 'src/cart.js', 'src/catalog.js', 'src/cli.js', 'src/csv.js', 'src/errors.js',
  'src/files.js', 'src/json.js', 'src/money.js', 'src/offers.js', 'src/receipt.js', 'src/split.js', 'src/store.js',
  'src/vat.js', 'test/args.test.js', 'test/cli.test.js', 'test/offers.test.js', 'test/receipt.test.js', 'test/vat.test.js',
].slice(0, Number(option('--files', 20)));
const INTRO = 'You review code in the till repository below.';
const STATE = resolve(option('--state', join('results', 'batch-state.json')));
const LANES = {
  A: { label: 'A plain', name: 'A one at a time, no cache', batch: false, cache: null },
  B: { label: 'B cached', name: 'B one at a time, cached', batch: false, cache: { type: 'ephemeral' } },
  C: { label: 'C batch', name: 'C batch, no cache', batch: true, cache: null },
  D: { label: 'D batch 1h', name: 'D batch, cached 1h', batch: true, cache: { type: 'ephemeral', ttl: '1h' } },
  E: { label: 'E warmed', name: 'E batch, warmed, cached 1h', batch: true, cache: { type: 'ephemeral', ttl: '1h' }, warm: true },
};

const client = new Anthropic({ maxRetries: 4 });
const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { lanes: {} });
const save = state => {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(state, null, 2));
};
const metered = (key, quiet = false) =>
  meter(new Anthropic({ maxRetries: 4 }), { label: LANES[key].label, log: join(dirname(STATE), `batch-${key}.jsonl`), quiet });

// One review request. The system prompt (the till) is the same in every request of a lane; only the file differs.
function params(lane, runId, path) {
  const system = [{ type: 'text', text: tillPrompt(runId, INTRO), ...(lane.cache && { cache_control: lane.cache }) }];
  const ask = `Review ${path}. List at most five problems a careful reviewer would raise, bugs first, one line each, most important first. If there are none, say so.`;
  return { model: MODEL, max_tokens: 2000, system, messages: [{ role: 'user', content: ask }] };
}
const customId = path => path.replace(/[^a-zA-Z0-9_-]/g, '_');

async function submit() {
  const state = load();
  for (const key of ['C', 'D', 'E']) {
    const lane = LANES[key];
    const runId = newRunId();
    if (lane.warm) {
      // writes the cache at the system prompt's breakpoint and generates nothing (not allowed inside a batch)
      const warm = metered(key);
      const first = params(lane, runId, FILES[0]);
      await warm.messages.create({ ...first, max_tokens: 0 });
      state.lanes[key] = { warm_call: warm.meter.calls[0] };
    }
    const batch = await client.messages.batches.create({
      requests: FILES.map(path => ({ custom_id: customId(path), params: params(lane, runId, path) })),
    });
    state.lanes[key] = { ...state.lanes[key], run_id: runId, batch_id: batch.id, files: FILES, submitted_at: batch.created_at };
    console.log(`${lane.name}: batch ${batch.id}, ${FILES.length} requests, ${batch.processing_status}`);
    save(state);
  }
}

async function normal() {
  const state = load();
  for (const key of ['A', 'B']) {
    const lane = LANES[key];
    const runId = newRunId();
    const c = metered(key);
    const started = Date.now();
    console.log(`\n${lane.name}`);
    // the first call on its own: a cache entry can only be read once the call that writes it has started answering
    await c.messages.create(params(lane, runId, FILES[0]));
    const rest = FILES.slice(1);
    for (let i = 0; i < rest.length; i += 4) {
      await Promise.all(rest.slice(i, i + 4).map(path => c.messages.create(params(lane, runId, path))));
    }
    state.lanes[key] = { run_id: runId, files: FILES, ms: Date.now() - started, summary: c.meter.summary() };
    save(state);
  }
}

async function collect() {
  const state = load();
  for (const key of ['C', 'D', 'E']) {
    const entry = state.lanes[key];
    if (!entry?.batch_id || entry.ended_at) continue; // collected already: the table below still has it
    let batch = await client.messages.batches.retrieve(entry.batch_id);
    while (batch.processing_status !== 'ended') {
      const n = batch.request_counts;
      console.log(`${LANES[key].name}: ${batch.processing_status}, ${n.succeeded} done, ${n.processing} to go (${new Date().toLocaleTimeString('en-GB')})`);
      await sleep(30_000);
      batch = await client.messages.batches.retrieve(entry.batch_id);
    }
    console.log(`\n${LANES[key].name}: ended (${batch.request_counts.succeeded} succeeded, ${batch.request_counts.errored} errored, ${batch.request_counts.expired} expired)`);
    const c = metered(key);
    if (entry.warm_call) c.meter.calls.push(entry.warm_call);
    const byId = Object.fromEntries(entry.files.map(path => [customId(path), params(LANES[key], entry.run_id, path)]));
    for await (const result of await client.messages.batches.results(entry.batch_id)) c.meter.recordBatch(result, byId[result.custom_id]);
    entry.ended_at = batch.ended_at;
    entry.minutes = Math.round((Date.parse(batch.ended_at) - Date.parse(batch.created_at)) / 600) / 100;
    entry.summary = c.meter.summary();
    save(state);
  }
  table(state);
}

function table(state) {
  console.log(`\nTest 3: ${FILES.length} reviews, five ways\n`);
  console.log(`${'lane'.padEnd(29)}${'reviews'.padEnd(9)}${'hit rate'.padEnd(10)}${'spent'.padEnd(10)}${'per review'.padEnd(12)}time`);
  const rows = [];
  for (const [key, lane] of Object.entries(LANES)) {
    const s = state.lanes[key]?.summary;
    if (!s) continue;
    const reviews = s.calls - (state.lanes[key].warm_call ? 1 : 0);
    const time = lane.batch ? `${state.lanes[key].minutes} min to results` : `${Math.round(state.lanes[key].ms / 1000)} s`;
    console.log(`${lane.name.padEnd(29)}${String(reviews).padEnd(9)}${`${(s.hit_rate * 100).toFixed(1)}%`.padEnd(10)}${usd(s.spent).padEnd(10)}` +
      `${usd(s.spent / (reviews || 1)).padEnd(12)}${time}`);
    rows.push({ lane: key, name: lane.name, reviews, ...s });
  }
  writeFileSync(join(dirname(STATE), 'batch-result.json'), JSON.stringify({ model: MODEL, files: FILES, lanes: rows, state }, null, 2));
}

const step = process.argv[2];
if (step === 'submit') await submit();
else if (step === 'normal') await normal();
else if (step === 'collect') await collect();
else if (step === 'all') {
  await submit();
  await normal();
  await collect();
} else {
  console.error('usage: node examples/batch.mjs submit|normal|collect|all [--files n]');
  process.exitCode = 2;
}

// Test 1: the price tag of one cached call. The same question three times, with the whole till (about 30,000
// tokens) in the system prompt: caching off, then on (the first cached call writes the cache), then on again
// (it reads it back). Each call's raw usage block, and what the pricing page charges for it.
//
//   node examples/price-tag.mjs
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { meter, fmt, usd } from '../cache-meter.mjs';
import { priceOf } from '../prices.mjs';
import { MODEL, newRunId, outDir, tillPrompt } from './shared.mjs';

const QUESTION = 'In one sentence: what does src/offers.js do?';
const INTRO = 'You answer questions about the till repository below, briefly.';

const out = outDir('price-tag');
const client = meter(new Anthropic({ maxRetries: 4 }), { label: 'price tag', log: join(out, 'calls.jsonl') });
const text = tillPrompt(newRunId(), INTRO);
const p = priceOf(MODEL);

const CALLS = [
  ['1. caching off', false],
  ['2. caching on, the first time: it writes the cache', true],
  ['3. caching on, again: it reads the cache', true],
];

const rows = [];
for (const [title, cache] of CALLS) {
  const system = [{ type: 'text', text, ...(cache && { cache_control: { type: 'ephemeral' } }) }];
  console.log(`\n${title}`);
  const message = await client.messages.create({ model: MODEL, max_tokens: 1000, system, messages: [{ role: 'user', content: QUESTION }] });
  const u = message.usage;
  console.log(JSON.stringify({
    input_tokens: u.input_tokens,
    cache_creation_input_tokens: u.cache_creation_input_tokens,
    cache_read_input_tokens: u.cache_read_input_tokens,
    output_tokens: u.output_tokens,
  }, null, 2));
  const items = [
    ['input', u.input_tokens, p.input],
    ['cache write', u.cache_creation_input_tokens ?? 0, p.write5m],
    ['cache read', u.cache_read_input_tokens ?? 0, p.read],
    ['output', u.output_tokens, p.output],
  ].filter(([, n]) => n > 0);
  for (const [kind, n, rate] of items) {
    const dollars = (n * rate) / 1e6;
    console.log(`  ${fmt(n).padStart(7)} ${kind.padEnd(11)} × $${rate.toFixed(2)}/MTok = ${dollars < 0.0001 ? `$${dollars.toFixed(6)}` : usd(dollars)}`);
  }
  const call = client.meter.calls.at(-1);
  console.log(`  this call: ${usd(call.cost)}`);
  rows.push({ title, cache, usage: u, cost: call.cost, answer: message.content.find(b => b.type === 'text')?.text ?? '' });
}

const [off, write, read] = rows;
const prefix = write.usage.cache_creation_input_tokens || off.usage.input_tokens;
console.log(`\nThe ${fmt(prefix)}-token prefix, three ways (${MODEL}):`);
console.log(`  at full price  ${usd((prefix * p.input) / 1e6)}`);
console.log(`  written        ${usd((prefix * p.write5m) / 1e6)}  (${p.write5m / p.input}x)`);
console.log(`  read back      ${usd((prefix * p.read) / 1e6)}  (${p.read / p.input}x)`);
console.log(`\nThe answer: ${read.answer.trim()}`);
writeFileSync(join(out, 'result.json'), JSON.stringify({ model: MODEL, question: QUESTION, prices: p, calls: rows }, null, 2));
console.log(`\nResults: ${out}`);

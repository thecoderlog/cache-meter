// Test 2: when caching loses. Four small experiments, each with its own meter:
//
//   a  a prompt under the minimum (512 tokens on Sonnet 5.5): cache_control is ignored, with no error
//   b  a prompt asked once: the write costs 25% more than no caching, and nothing ever reads it
//   c  a 6-minute pause: the default 5-minute cache is gone, the 1-hour one (written at 2x) is still there
//   d  the time at the top of the prompt: every call writes the cache again and none reads it
//
//   node examples/when-it-loses.mjs          (the pause is 6 minutes; --pause <seconds> to change it)
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { meter, usd } from '../cache-meter.mjs';
import { MODEL, newRunId, option, outDir, sleep, tillPrompt } from './shared.mjs';

const PAUSE = Number(option('--pause', 360));
const INTRO = 'You answer questions about the till repository below, briefly.';
const ASK = [{ role: 'user', content: 'In one sentence: what does src/split.js do?' }];
const out = outDir('when-it-loses');
const log = join(out, 'calls.jsonl');
const client = label => meter(new Anthropic({ maxRetries: 4 }), { label, log });
const cached = (text, ttl) => [{ type: 'text', text, cache_control: ttl ? { type: 'ephemeral', ttl } : { type: 'ephemeral' } }];
const ask = (c, system) => c.messages.create({ model: MODEL, max_tokens: 1000, system, messages: ASK });

// c starts first: its pause runs while a, b and d go
const pauseText = PAUSE % 60 === 0 ? `${PAUSE / 60}-minute` : `${PAUSE}-second`;
console.log(`c. A ${pauseText} pause between two calls: the 5-minute cache against the 1-hour one`);
const short = client('c 5-minute');
const long = client('c 1-hour');
const shortText = tillPrompt(newRunId(), INTRO);
const longText = tillPrompt(newRunId(), INTRO);
await Promise.all([ask(short, cached(shortText)), ask(long, cached(longText, '1h'))]);
const pauseEnds = Date.now() + PAUSE * 1000;
console.log(`   both written; the second calls go at ${new Date(pauseEnds).toLocaleTimeString('en-GB')}\n`);

console.log('a. A prompt under the minimum, with cache_control, twice');
const tiny = client('a tiny');
const tinySystem = cached(`Run ${newRunId()}\n\nYou answer questions about a shop till, briefly. The till prints receipts 32 characters wide.`);
await ask(tiny, tinySystem);
await ask(tiny, tinySystem);

console.log('\nb. The same question asked once: cached against not cached');
const once = client('b cached');
const plain = client('b plain');
await ask(once, cached(tillPrompt(newRunId(), INTRO)));
await ask(plain, [{ type: 'text', text: tillPrompt(newRunId(), INTRO) }]);

console.log('\nd. The time at the top of the system prompt, twice, a few seconds apart');
const stamped = client('d time');
const stampId = newRunId();
for (let i = 0; i < 2; i++) {
  await ask(stamped, cached(`Now: ${new Date().toISOString()}\n${tillPrompt(stampId, INTRO)}`));
  if (i === 0) await sleep(3000);
}

const wait = pauseEnds - Date.now();
if (wait > 0) {
  console.log(`\nc. Waiting ${Math.round(wait / 1000)} seconds more for the end of the pause…`);
  await sleep(wait);
}
console.log('\nc. The second calls, after the pause');
await Promise.all([ask(short, cached(shortText)), ask(long, cached(longText, '1h'))]);

// the table
const lanes = [
  ['a  under the minimum', tiny],
  ['b  asked once, cached', once],
  ['b  asked once, plain', plain],
  ['c  pause, 5-minute cache', short],
  ['c  pause, 1-hour cache', long],
  ['d  timestamp on top', stamped],
];
console.log('\nTest 2: when caching loses\n');
console.log(`${'lane'.padEnd(28)}${'calls'.padEnd(7)}${'written'.padEnd(10)}${'read'.padEnd(10)}${'spent'.padEnd(10)}without caching`);
const result = [];
for (const [name, c] of lanes) {
  const s = c.meter.summary();
  const written = s.tokens.write5m + s.tokens.write1h;
  console.log(`${name.padEnd(28)}${String(s.calls).padEnd(7)}${written.toLocaleString('en-US').padEnd(10)}${s.tokens.read.toLocaleString('en-US').padEnd(10)}` +
    `${usd(s.spent).padEnd(10)}${usd(s.without_cache)}`);
  result.push({ lane: name, ...s, warnings: c.meter.calls.map(call => call.warning).filter(Boolean) });
}
writeFileSync(join(out, 'result.json'), JSON.stringify({ model: MODEL, pause_seconds: PAUSE, lanes: result }, null, 2));
console.log(`\nResults: ${out}`);

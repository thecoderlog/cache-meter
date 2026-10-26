import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { meter, promptShape, tokensOf, hasCacheControl } from '../cache-meter.mjs';
import { priceOf, minCacheable } from '../prices.mjs';

const MODEL = 'claude-sonnet-5-5';

// A client whose create() answers with the next usage block in the list
function fakeClient(usages) {
  const queue = [...usages];
  return {
    messages: {
      create: params => {
        const usage = queue.shift();
        return Promise.resolve({ id: 'msg_' + queue.length, model: params.model, usage, stop_reason: 'end_turn', content: [] });
      },
    },
  };
}

function sink() {
  const out = { text: '', isTTY: false, write: s => { out.text += s; } };
  return out;
}

const usage = (input, write, read, output, write1h = 0) => ({
  input_tokens: input,
  cache_creation_input_tokens: write + write1h,
  cache_read_input_tokens: read,
  cache_creation: { ephemeral_5m_input_tokens: write, ephemeral_1h_input_tokens: write1h },
  output_tokens: output,
});

const big = 'x'.repeat(4000);
const request = (extra = {}, messages = [{ role: 'user', content: 'hi' }]) => ({
  model: MODEL,
  max_tokens: 100,
  system: [{ type: 'text', text: big }],
  messages,
  ...extra,
});

describe('prices', () => {
  it('prices Sonnet 5.5 the way the pricing page does', () => {
    assert.deepEqual(priceOf(MODEL), { input: 2, write5m: 2.5, write1h: 4, read: 0.1, output: 10 });
  });

  it('takes the longest match, so Opus 5.5 is not priced as Opus 5', () => {
    assert.equal(priceOf('claude-opus-5-5').input, 4);
    assert.equal(priceOf('claude-opus-5').input, 5);
    assert.equal(priceOf('claude-opus-5-20260301').input, 5);
  });

  it('prices Haiku 5.5 by the size of the prompt', () => {
    assert.equal(priceOf('claude-haiku-5-5', 100_000).input, 0.1);
    assert.equal(priceOf('claude-haiku-5-5', 100_001).input, 0.5);
  });

  it('knows nothing about other models', () => {
    assert.equal(priceOf('gpt-4o'), null);
  });

  it('knows each model\'s shortest cacheable prompt', () => {
    assert.equal(minCacheable(MODEL), 512);
    assert.equal(minCacheable('claude-sonnet-5'), 1024);
    assert.equal(minCacheable('claude-haiku-4-5'), 4096);
  });
});

describe('meter', () => {
  it('prices a call with no caching', async () => {
    const client = meter(fakeClient([usage(30_000, 0, 0, 500)]), { out: sink() });
    await client.messages.create(request());
    const [call] = client.meter.calls;
    // 30,000 × $2 + 500 × $10, per million
    assert.equal(call.cost, 0.065);
    assert.equal(call.without_cache, 0.065);
    assert.equal(call.cache, 'off');
  });

  it('prices a cache write, a 1-hour write and a cache read', async () => {
    const client = meter(fakeClient([usage(10, 30_000, 0, 500), usage(10, 0, 0, 500, 30_000), usage(10, 0, 30_000, 500)]), {
      out: sink(),
    });
    const params = request({ cache_control: { type: 'ephemeral' } });
    await client.messages.create(params);
    await client.messages.create(params);
    await client.messages.create(params);
    const [write, write1h, read] = client.meter.calls;
    assert.equal(write.cost, 0.08002); // 10 × 2 + 30,000 × 2.5 + 500 × 10
    assert.equal(write1h.cost, 0.12502); // 30,000 × 4
    assert.equal(read.cost, 0.00802); // 30,000 × 0.10
    assert.equal(read.without_cache, 0.06502);
    assert.equal(read.cache, 'on');
  });

  it('prices Batch results at half', () => {
    const m = meter(fakeClient([]), { out: sink() }).meter;
    const call = m.recordBatch({ custom_id: 'r1', result: { type: 'succeeded', message: { model: MODEL, usage: usage(30_000, 0, 0, 500) } } });
    assert.equal(call.cost, 0.0325);
    assert.equal(call.batch, true);
  });

  it('skips a batch result that did not succeed', () => {
    const out = sink();
    const m = meter(fakeClient([]), { out }).meter;
    assert.equal(m.recordBatch({ custom_id: 'r1', result: { type: 'expired' } }), null);
    assert.match(out.text, /r1: expired, not metered/);
  });

  it('adds up the calls', async () => {
    const client = meter(fakeClient([usage(10, 30_000, 0, 500), usage(10, 100, 30_000, 500)]), { out: sink() });
    const params = request({ cache_control: { type: 'ephemeral' } });
    await client.messages.create(params);
    await client.messages.create(params);
    const s = client.meter.summary();
    assert.equal(s.calls, 2);
    assert.deepEqual(s.tokens, { input: 20, write5m: 30_100, write1h: 0, read: 30_000, output: 1000 });
    assert.equal(s.hit_rate, 30_000 / 60_120);
    assert.equal(s.spent, round(0.08002 + (10 * 2 + 100 * 2.5 + 30_000 * 0.1 + 500 * 10) / 1e6));
    assert.equal(s.without_cache, round((60_120 * 2 + 1000 * 10) / 1e6));
    assert.equal(s.saved, round(s.without_cache - s.spent));
  });

  it('writes one JSON line per call to the log', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'cache-meter-')), 'calls.jsonl');
    const client = meter(fakeClient([usage(30_000, 0, 0, 500), usage(30_000, 0, 0, 500)]), { out: sink(), log, label: 'A' });
    await client.messages.create(request());
    await client.messages.create(request());
    const rows = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(rows.length, 2);
    assert.equal(rows[1].label, 'A');
    assert.equal(rows[1].n, 2);
    assert.equal(rows[1].usage.input_tokens, 30_000);
  });

  it('prints one line per call', async () => {
    const out = sink();
    const client = meter(fakeClient([usage(31_914, 0, 0, 512)]), { out, label: 'A no cache' });
    await client.messages.create(request());
    // 31,914 × $2 + 512 × $10 = $0.0689; with caching it would have been written at $2.50: $0.0849
    assert.equal(out.text, 'A no cache   #1    in  31,914  write       0  read       0  out    512   $0.0689  run $0.0689  would save -$0.0160\n');
  });

  it('keeps the response as it was', async () => {
    const client = meter(fakeClient([usage(1, 0, 0, 1)]), { out: sink() });
    const message = await client.messages.create(request());
    assert.equal(message.id, 'msg_0');
    assert.deepEqual(Object.keys(message), ['id', 'model', 'usage', 'stop_reason', 'content']);
  });
});

describe('the "would save" estimate', () => {
  it('counts the first call as a full write', async () => {
    const client = meter(fakeClient([usage(30_000, 0, 0, 500)]), { out: sink() });
    await client.messages.create(request());
    // 30,000 × $2.50 + 500 × $10
    assert.equal(client.meter.calls[0].with_cache_estimate, 0.08);
  });

  it('reads back what the previous call sent, and writes the rest', async () => {
    const client = meter(fakeClient([usage(30_000, 0, 0, 500), usage(31_000, 0, 0, 500)]), { out: sink() });
    const first = request();
    await client.messages.create(first);
    const next = request({}, [...first.messages, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'more' }]);
    await client.messages.create(next);
    // 30,000 read × $0.10 + 1,000 written × $2.50 + 500 × $10
    assert.equal(client.meter.calls[1].with_cache_estimate, round((30_000 * 0.1 + 1000 * 2.5 + 500 * 10) / 1e6));
  });

  it('reads only the shared part when the prompt changed', async () => {
    const client = meter(fakeClient([usage(30_000, 0, 0, 500), usage(30_000, 0, 0, 500)]), { out: sink() });
    await client.messages.create(request({}, [{ role: 'user', content: 'a'.repeat(4000) }]));
    await client.messages.create(request({}, [{ role: 'user', content: 'b'.repeat(4000) }]));
    const est = client.meter.calls[1].with_cache_estimate;
    // about half the prompt is the shared system block
    assert.ok(est > (15_000 * 0.1 + 15_000 * 2.5) / 1e6 * 0.9 && est < 0.08, String(est));
  });

  it('reads nothing after a different model or thinking setting', async () => {
    const client = meter(fakeClient([usage(30_000, 0, 0, 0), usage(30_000, 0, 0, 0)]), { out: sink() });
    await client.messages.create(request());
    await client.messages.create(request({ thinking: { type: 'adaptive' }, output_config: { effort: 'low' } }));
    assert.equal(client.meter.calls[1].with_cache_estimate, 0.075);
  });

  it('caches nothing under the minimum', async () => {
    const client = meter(fakeClient([usage(300, 0, 0, 0), usage(300, 0, 0, 0)]), { out: sink() });
    const small = { model: MODEL, max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] };
    await client.messages.create(small);
    await client.messages.create(small);
    assert.equal(client.meter.calls[1].with_cache_estimate, client.meter.calls[1].cost);
  });

  it('adds up to a summary line', async () => {
    const client = meter(fakeClient([usage(30_000, 0, 0, 500), usage(31_000, 0, 0, 500)]), { out: sink() });
    const first = request();
    await client.messages.create(first);
    await client.messages.create(request({}, [...first.messages, { role: 'assistant', content: 'x' }, { role: 'user', content: 'y' }]));
    // spent 61,000 × $2 + 1,000 × $10 = $0.1320; with caching $0.0800 + $0.0105
    assert.match(client.meter.summaryText(), /with caching \(est\.\) +\$0\.0905  would save \$0\.0415 \(31\.4%\)/);
  });
});

describe('warnings', () => {
  it('says when a prompt is too short to cache', async () => {
    const out = sink();
    const client = meter(fakeClient([usage(300, 0, 0, 10)]), { out });
    await client.messages.create({ model: MODEL, max_tokens: 10, system: [{ type: 'text', text: 'short', cache_control: { type: 'ephemeral' } }], messages: [] });
    assert.equal(client.meter.calls[0].cache, 'asked, nothing cached');
    assert.match(out.text, /nothing cached: the prompt is 300 tokens, under the 512-token minimum for claude-sonnet-5-5/);
  });

  it('says when every call writes and none reads', async () => {
    const out = sink();
    const client = meter(fakeClient([usage(10, 30_000, 0, 10), usage(10, 30_000, 0, 10)]), { out });
    const params = request({ cache_control: { type: 'ephemeral' } });
    await client.messages.create(params);
    await client.messages.create(params);
    assert.match(client.meter.calls[1].warning, /written again and never read/);
  });
});

describe('helpers', () => {
  it('splits writes by lifetime', () => {
    assert.deepEqual(tokensOf(usage(1, 2, 3, 4, 5)), { input: 1, write5m: 2, write1h: 5, read: 3, output: 4 });
    assert.deepEqual(tokensOf({ input_tokens: 1, cache_creation_input_tokens: 7, output_tokens: 2 }), { input: 1, write5m: 7, write1h: 0, read: 0, output: 2 });
  });

  it('finds cache_control anywhere in a request', () => {
    assert.equal(hasCacheControl(request()), false);
    assert.equal(hasCacheControl(request({ cache_control: { type: 'ephemeral' } })), true);
    assert.equal(hasCacheControl({ messages: [{ role: 'user', content: [{ type: 'text', text: 'x', cache_control: { type: 'ephemeral' } }] }] }), true);
    assert.equal(hasCacheControl({ tools: [{ name: 't', cache_control: { type: 'ephemeral' } }], messages: [] }), true);
  });

  it('reads a prompt in the order the API does, without the markers', () => {
    const shape = promptShape({
      model: MODEL,
      tools: [{ name: 't' }],
      system: [{ type: 'text', text: 's', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'u' }],
    });
    assert.deepEqual(shape.blocks, ['tool:{"name":"t"}', 'system:{"type":"text","text":"s"}', 'user:{"type":"text","text":"u"}']);
  });
});

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

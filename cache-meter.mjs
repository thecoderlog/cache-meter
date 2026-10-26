// cache-meter: what each Claude API call cost, what prompt caching saved, and, when caching is off, what it
// would save. It reads the usage block of every response and prices it with prices.mjs. Nothing is sent
// anywhere: one line per call on stderr, a summary when you ask, and a JSONL log if you give it a file.
//
//   import Anthropic from '@anthropic-ai/sdk';
//   import { meter } from 'cache-meter';
//
//   const client = meter(new Anthropic(), { label: 'my agent' });
//   const message = await client.messages.create({ ... });   // → one line on stderr
//   client.meter.printSummary();
import { appendFileSync } from 'node:fs';
import { BATCH, minCacheable, priceOf } from './prices.mjs';

// A cache entry lives 5 minutes from the start of the last request that wrote or read it
const TTL_MS = 5 * 60 * 1000;

const COLORS = {
  teal: '\x1b[38;5;37m',
  purple: '\x1b[38;5;141m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

// Wraps client.messages.create (and client.messages.stream) so every response is metered, and puts the meter on
// client.meter. The calls themselves are untouched: same arguments, same return value.
//
// options:
//   label   a name for this client's lines and log rows ('A no cache')
//   color   the label's colour: 'teal', 'purple' or none
//   log     a file to append one JSON line per call to (default: $CACHE_METER_LOG)
//   quiet   true: no per-call lines (the summary still works)
//   notes   true: a second line per call with the tools the model called
//   clock   true: the time since the meter started, on every line
//   out     where lines go (default process.stderr)
export function meter(client, options = {}) {
  const m = new Meter(options);
  const messages = client.messages;
  const create = messages.create.bind(messages);
  messages.create = (params, requestOptions) => {
    const started = Date.now();
    const promise = create(params, requestOptions);
    if (params?.stream) {
      m.warnOnce('stream', 'create() with stream: true is not metered; use client.messages.stream() instead');
      return promise;
    }
    promise.then(message => m.record(params, message, { started }), () => {});
    return promise;
  };
  if (typeof messages.stream === 'function') {
    const stream = messages.stream.bind(messages);
    messages.stream = (params, requestOptions) => {
      const started = Date.now();
      const s = stream(params, requestOptions);
      s.finalMessage().then(message => m.record(params, message, { started }), () => {});
      return s;
    };
  }
  client.meter = m;
  return client;
}

export class Meter {
  constructor({ label = '', color = '', log = process.env.CACHE_METER_LOG, quiet = false, notes = false, clock = false, out = process.stderr } = {}) {
    Object.assign(this, { label, color, log, quiet, notes, clock, out });
    this.calls = [];
    this.startedAt = Date.now();
    this.previous = null; // the last call's prompt, for the "would save" estimate
    this.warned = new Set();
  }

  // Meters one response. `params` is the request it answered (needed for the estimate and the warnings);
  // batch: true prices it at Message Batches rates.
  record(params, message, { started = Date.now(), batch = false, id } = {}) {
    const usage = message?.usage ?? {};
    const model = message?.model || params?.model;
    const t = tokensOf(usage);
    const prompt = t.input + t.write5m + t.write1h + t.read;
    const price = priceOf(model, prompt);
    if (!price) this.warnOnce(`price:${model}`, `no price for ${model} in prices.mjs; its calls count as $0`);
    const k = batch ? BATCH : 1;
    const p = price ?? { input: 0, write5m: 0, write1h: 0, read: 0, output: 0 };
    // dollars by kind of token
    const parts = {
      input: (k * t.input * p.input) / 1e6,
      write: (k * (t.write5m * p.write5m + t.write1h * p.write1h)) / 1e6,
      read: (k * t.read * p.read) / 1e6,
      output: (k * t.output * p.output) / 1e6,
    };
    const cost = parts.input + parts.write + parts.read + parts.output;
    const withoutCache = (k * (prompt * p.input + t.output * p.output)) / 1e6;
    const asked = hasCacheControl(params);
    const cached = t.write5m + t.write1h + t.read > 0;

    // Caching off: what this call would have cost with it, from how much of its prompt the previous call already
    // sent (estimate, below). Caching on: what it cost, against the same call with no caching at all.
    const shape = params ? promptShape(params, model) : null;
    let withCache = null;
    if (!asked && !cached && shape && !batch) withCache = this.estimateWithCache(shape, prompt, t.output, p, started, model) / 1e6;
    this.previous = shape && { ...shape, prompt, started, model };

    const call = {
      n: this.calls.length + 1,
      at: new Date(started).toISOString(),
      ms: Date.now() - started,
      label: this.label,
      id: id ?? message?.id,
      model,
      batch,
      cache: cached ? 'on' : asked ? 'asked, nothing cached' : 'off',
      tokens: t,
      prompt,
      cost: round6(cost),
      dollars: Object.fromEntries(Object.entries(parts).map(([kind, d]) => [kind, round6(d)])),
      without_cache: round6(withoutCache),
      with_cache_estimate: withCache === null ? null : round6(withCache),
      stop: message?.stop_reason ?? null,
      tools: (message?.content ?? []).filter(b => b.type === 'tool_use').map(b => describeTool(b)),
    };
    call.warning = this.warning(call, asked, model, started);
    this.calls.push(call);
    if (this.log) appendFileSync(this.log, JSON.stringify({ ...call, usage }) + '\n');
    if (!this.quiet) this.print(call);
    return call;
  }

  // A batch result as client.messages.batches.results() yields it: priced at Batch rates. Pass the request's
  // params too, for the warnings.
  recordBatch(result, params) {
    if (result?.result?.type !== 'succeeded') {
      this.warnOnce(`batch:${result?.result?.type}`, `batch request ${result?.custom_id}: ${result?.result?.type}, not metered`);
      return null;
    }
    return this.record(params, result.result.message, { batch: true, id: result.custom_id });
  }

  // The same prompt with automatic caching on (cache_control at the top of the request): the part the previous
  // call sent, unchanged and still in its 5 minutes, would be read from the cache; the rest written to it. In
  // dollars per million tokens.
  estimateWithCache(shape, prompt, output, p, started, model) {
    const prev = this.previous;
    let reused = 0;
    if (prev && prev.model === model && prev.settings === shape.settings && started - prev.started < TTL_MS) {
      let same = 0;
      while (same < prev.blocks.length && same < shape.blocks.length && prev.blocks[same] === shape.blocks[same]) same++;
      reused = same === prev.blocks.length ? prev.prompt : Math.floor((prev.prompt * chars(prev.blocks, same)) / chars(prev.blocks));
    }
    const min = minCacheable(model);
    if (reused < min) reused = 0;
    reused = Math.min(reused, prompt);
    const written = prompt >= min ? prompt - reused : 0;
    const full = prompt - reused - written;
    return reused * p.read + written * p.write5m + full * p.input + output * p.output;
  }

  warning(call, asked, model, started) {
    const { tokens: t, prompt } = call;
    if (asked && call.cache !== 'on') {
      const min = minCacheable(model);
      return prompt < min
        ? `nothing cached: the prompt is ${fmt(prompt)} tokens, under the ${fmt(min)}-token minimum for ${model}`
        : 'nothing cached, though the request has cache_control: is the breakpoint on a block that can be cached?';
    }
    const before = this.calls.at(-1);
    if (call.cache === 'on' && t.read === 0 && before?.cache === 'on' && !call.batch) {
      const gap = started - Date.parse(before.at);
      if (gap >= TTL_MS && before.tokens.write1h === 0) {
        return `written again: the last call was ${clockOf(gap)} ago, past the 5-minute lifetime (ttl: '1h' keeps it an hour)`;
      }
      if (before.tokens.read === 0) {
        return 'written again and never read: does something before the breakpoint change on every call (a time, an id)?';
      }
    }
    return null;
  }

  // Totals so far: tokens by kind, dollars, and the hit rate (cache reads ÷ all prompt tokens)
  summary() {
    const t = { input: 0, write5m: 0, write1h: 0, read: 0, output: 0 };
    const dollars = { input: 0, write: 0, read: 0, output: 0 };
    let spent = 0;
    let without = 0;
    let estimate = 0;
    let estimated = 0;
    for (const call of this.calls) {
      for (const key of Object.keys(t)) t[key] += call.tokens[key];
      for (const key of Object.keys(dollars)) dollars[key] += call.dollars[key];
      spent += call.cost;
      without += call.without_cache;
      if (call.with_cache_estimate !== null) {
        estimate += call.with_cache_estimate;
        estimated++;
      }
    }
    const prompt = t.input + t.write5m + t.write1h + t.read;
    return {
      label: this.label,
      calls: this.calls.length,
      models: [...new Set(this.calls.map(call => call.model))],
      tokens: t,
      dollars: Object.fromEntries(Object.entries(dollars).map(([kind, d]) => [kind, round6(d)])),
      prompt,
      batch: this.calls.length > 0 && this.calls.every(call => call.batch),
      hit_rate: prompt ? t.read / prompt : 0,
      spent: round6(spent),
      without_cache: round6(without),
      saved: round6(without - spent),
      // only when every call ran without caching: what they'd have cost with it
      with_cache_estimate: estimated && estimated === this.calls.length ? round6(estimate) : null,
    };
  }

  spent() {
    return this.calls.reduce((total, call) => total + call.cost, 0);
  }

  printSummary(out = this.out) {
    out.write(this.summaryText() + '\n');
  }

  summaryText() {
    const s = this.summary();
    const t = s.tokens;
    const writes = t.write5m + t.write1h;
    const d = s.dollars;
    const lines = [
      `${this.paint(this.label || 'cache-meter')}: ${s.calls} call${s.calls === 1 ? '' : 's'}, ${s.models.join(', ')}${s.batch ? ' (Batch prices)' : ''}`,
      `  input at full price  ${fmt(t.input).padStart(11)} tokens  ${usd(d.input)}`,
      `  cache writes         ${fmt(writes).padStart(11)} tokens  ${usd(d.write)}`,
      `  cache reads          ${fmt(t.read).padStart(11)} tokens  ${usd(d.read)}`,
      `  output               ${fmt(t.output).padStart(11)} tokens  ${usd(d.output)}`,
      `  hit rate             ${pct(s.hit_rate).padStart(11)}  of all input read from the cache`,
      `  spent                ${usd(s.spent).padStart(11)}`,
    ];
    if (s.hit_rate > 0 || writes > 0) {
      lines.push(`  without caching      ${usd(s.without_cache).padStart(11)}  saved ${usd(s.saved)} (${pct(s.saved / (s.without_cache || 1))})`);
    } else if (s.with_cache_estimate !== null) {
      const save = s.spent - s.with_cache_estimate;
      lines.push(`  with caching (est.)  ${usd(s.with_cache_estimate).padStart(11)}  would save ${usd(save)} (${pct(save / (s.spent || 1))})`);
    }
    return lines.join('\n');
  }

  print(call) {
    const { tokens: t } = call;
    const writes = t.write5m + t.write1h;
    const parts = [
      this.paint((this.label || 'cache-meter').padEnd(11)),
      this.clock ? this.dim(clockOf(Date.now() - this.startedAt)) : null,
      `#${String(call.n).padEnd(3)}`,
      `in ${fmt(t.input).padStart(7)}`,
      `write ${fmt(writes).padStart(7)}`,
      `read ${fmt(t.read).padStart(7)}`,
      `out ${fmt(t.output).padStart(6)}`,
      ` ${usd(call.cost)}`,
      `run ${usd(this.spent())}`,
    ];
    if (call.cache === 'on') parts.push(this.money('saved', call.without_cache - call.cost));
    else if (call.with_cache_estimate !== null) parts.push(this.money('would save', call.cost - call.with_cache_estimate));
    let text = parts.filter(Boolean).join('  ');
    if (call.batch) text += this.dim('  (Batch)');
    // the tools line is cut to the terminal's width, so it never wraps
    const room = (this.out?.isTTY && this.out.columns) || Infinity;
    const tools = '↳ ' + call.tools.join(' · ');
    if (this.notes && call.tools.length) text += '\n' + ' '.repeat(13) + this.dim(tools.length > room - 13 ? tools.slice(0, room - 14) + '…' : tools);
    if (this.notes && !call.tools.length && call.stop === 'end_turn') text += '\n' + ' '.repeat(13) + this.dim('↳ done');
    if (call.warning) text += '\n' + ' '.repeat(13) + this.tint('yellow', '⚠ ' + call.warning);
    this.out.write(text + '\n');
  }

  warnOnce(key, text) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.out.write(`cache-meter: ${text}\n`);
  }

  get colorful() {
    return Boolean(this.out?.isTTY) && !process.env.NO_COLOR;
  }

  tint(color, text) {
    return this.colorful && COLORS[color] ? COLORS[color] + text + COLORS.reset : text;
  }

  paint(text) {
    return this.tint(this.color, text);
  }

  dim(text) {
    return this.tint('dim', text);
  }

  money(word, dollars) {
    const text = `${word} ${usd(dollars)}`;
    return dollars < 0 ? this.tint('red', text) : this.tint('green', text);
  }
}

// The usage block's prompt tokens by kind. cache_creation splits the writes by lifetime; without it they're 5-minute.
export function tokensOf(usage) {
  const written = usage.cache_creation_input_tokens ?? 0;
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  return {
    input: usage.input_tokens ?? 0,
    write5m: Math.max(0, written - write1h),
    write1h,
    read: usage.cache_read_input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
  };
}

// Does the request ask for caching anywhere: at the top, or on a tool, system block or message block?
export function hasCacheControl(params) {
  if (!params) return false;
  if (params.cache_control) return true;
  const blocks = [...(params.tools ?? []), ...(Array.isArray(params.system) ? params.system : [])];
  for (const message of params.messages ?? []) if (Array.isArray(message.content)) blocks.push(...message.content);
  return blocks.some(block => block?.cache_control);
}

// The prompt as the API reads it, block by block: tools, then system, then messages. cache_control markers are left
// out (they move from call to call without changing what's cached). settings holds what else changes the cache:
// thinking and effort.
export function promptShape(params, model = params.model) {
  const strip = block => {
    if (!block || typeof block !== 'object') return JSON.stringify(block);
    const { cache_control, ...rest } = block;
    return JSON.stringify(rest);
  };
  const blocks = (params.tools ?? []).map(tool => 'tool:' + strip(tool));
  const system = typeof params.system === 'string' ? [{ type: 'text', text: params.system }] : params.system ?? [];
  for (const block of system) blocks.push('system:' + strip(block));
  for (const message of params.messages ?? []) {
    const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? [];
    for (const block of content) blocks.push(message.role + ':' + strip(block));
  }
  const settings = JSON.stringify([model, params.thinking ?? null, params.output_config?.effort ?? null]);
  return { blocks, settings };
}

function chars(blocks, upTo = blocks.length) {
  let n = 0;
  for (let i = 0; i < upTo; i++) n += blocks[i].length;
  return n || 1;
}

function describeTool(block) {
  const input = block.input ?? {};
  const first = input.command ?? input.path ?? Object.values(input).find(v => typeof v === 'string') ?? '';
  const text = String(first).replace(/\s+/g, ' ').trim();
  return `${block.name} ${text.length > 48 ? text.slice(0, 47) + '…' : text}`.trim();
}

const round6 = n => Math.round(n * 1e6) / 1e6;
export const fmt = n => Math.round(n).toLocaleString('en-US');
export const usd = n => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(4);
const pct = x => `${(x * 100).toFixed(1)}%`;
const clockOf = ms => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

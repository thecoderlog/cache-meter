// Claude API list prices, in US dollars per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing
// (checked 2026-10-26). cache-meter takes every price from this file: when the page changes, change this file.
//
//   input    a prompt token at full price
//   write5m  a prompt token written to the cache with the default 5-minute lifetime (1.25 × input)
//   write1h  a prompt token written to the cache with the 1-hour lifetime (2 × input)
//   read     a prompt token read from the cache (0.1 × input on most models, less on the newest)
//   output   a generated token, thinking included
export const CHECKED = '2026-10-26';

// Message Batches API requests cost half, on every line above
export const BATCH = 0.5;

const OPUS_5 = { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 };
const SONNET_4 = { input: 3, write5m: 3.75, write1h: 6, read: 0.3, output: 15 };

// A model id, or the start of one ('claude-opus-5' also covers 'claude-opus-5-20260301'); the longest match
// wins, so 'claude-opus-5-5' isn't priced as 'claude-opus-5'. A list of tiers is priced by the size of the
// prompt: the first tier whose upTo the prompt doesn't pass.
export const PRICES = {
  'claude-fable-5-1': { input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 },
  'claude-fable-5': { input: 10, write5m: 12.5, write1h: 20, read: 1, output: 50 },
  'claude-opus-5-5': { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 },
  'claude-opus-5': OPUS_5,
  'claude-opus-4-8': OPUS_5,
  'claude-opus-4-7': OPUS_5,
  'claude-opus-4-6': OPUS_5,
  'claude-opus-4-5': OPUS_5,
  'claude-sonnet-5-5': { input: 2, write5m: 2.5, write1h: 4, read: 0.1, output: 10 },
  'claude-sonnet-5': { input: 2, write5m: 2.5, write1h: 4, read: 0.2, output: 10 },
  'claude-sonnet-4-6': SONNET_4,
  'claude-sonnet-4-5': SONNET_4,
  'claude-haiku-5-5': [
    { upTo: 100_000, input: 0.1, write5m: 0.125, write1h: 0.2, read: 0.01, output: 0.5 },
    { input: 0.5, write5m: 0.625, write1h: 1, read: 0.05, output: 2.5 },
  ],
  'claude-haiku-4-5': { input: 1, write5m: 1.25, write1h: 2, read: 0.1, output: 5 },
};

// The shortest prompt prefix each model will cache, in tokens. A shorter one isn't cached and isn't an error:
// both cache fields in the usage block just come back 0.
export const MIN_CACHEABLE = {
  'claude-fable-5': 512,
  'claude-opus-5': 512,
  'claude-sonnet-5-5': 512,
  'claude-haiku-5-5': 512,
  'claude-sonnet-5': 1024,
  'claude-opus-4-8': 1024,
  'claude-sonnet-4-6': 1024,
  'claude-sonnet-4-5': 1024,
  'claude-opus-4-7': 2048,
  'claude-opus-4-6': 4096,
  'claude-opus-4-5': 4096,
  'claude-haiku-4-5': 4096,
};

function lookup(table, model) {
  const key = Object.keys(table)
    .filter(prefix => model === prefix || model?.startsWith(prefix + '-'))
    .sort((a, b) => b.length - a.length)[0];
  return key === undefined ? undefined : table[key];
}

// → { input, write5m, write1h, read, output } in $/MTok for this model and prompt size, or null for a model this
// file doesn't know
export function priceOf(model, promptTokens = 0) {
  const entry = lookup(PRICES, model);
  if (!entry) return null;
  if (!Array.isArray(entry)) return entry;
  return entry.find(tier => tier.upTo === undefined || promptTokens <= tier.upTo);
}

export function minCacheable(model) {
  return lookup(MIN_CACHEABLE, model) ?? 1024;
}

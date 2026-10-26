# cache-meter

What each Claude API call cost, what prompt caching saved, and, when caching is off, what it would save.

```
A no cache   1:17  #9    in  58,307  write       0  read       0  out    300   $0.1196  run $1.0813  would save $0.1087
B cached     1:23  #7    in       2  write   1,616  read  60,764  out    395   $0.0141  run $0.3199  saved $0.1146
```

Those are the last calls of the same agent doing the same coding task twice, without caching and with it
(the race below, round 1).

cache-meter wraps an Anthropic client. It reads the `usage` block of every response and prices it with
[prices.mjs](prices.mjs): one line per call on stderr, a summary when you ask for one, and a JSONL log if you
give it a file. It sends nothing anywhere and has no dependencies.

## Use it

```js
import Anthropic from '@anthropic-ai/sdk';
import { meter } from 'cache-meter';

const client = meter(new Anthropic(), { label: 'my agent' });

const message = await client.messages.create({ ... }); // unchanged: same arguments, same result
client.meter.printSummary();
```

```
my agent: 7 calls, claude-sonnet-5-5
  input at full price           16 tokens  $0.0000
  cache writes              62,380 tokens  $0.1560
  cache reads              325,843 tokens  $0.0326
  output                    13,136 tokens  $0.1314
  hit rate                   83.9%  of all input read from the cache
  spent                    $0.3199
  without caching          $0.9078  saved $0.5879 (64.8%)
```

(That summary is the cached side's first run in the race below.)

Install it from GitHub (`npm install github:thecoderlog/cache-meter`) or copy `cache-meter.mjs` and
`prices.mjs` into your project.

Options for `meter(client, options)`:

| Option | What it does |
| --- | --- |
| `label` | A name for this client's lines and log rows |
| `color` | `'teal'` or `'purple'` for the label, in a terminal |
| `log` | A file to append one JSON line per call to (default: `$CACHE_METER_LOG`) |
| `quiet` | No per-call lines; the summary still works |
| `notes` | A second line per call with the tools the model called |
| `clock` | The time since the meter started, on every line |

`client.meter.summary()` returns the totals as an object, `client.meter.calls` has every call, and
`client.meter.recordBatch(result, params)` meters a Message Batches result at Batch prices:

```js
for await (const result of await client.messages.batches.results(batch.id)) {
  client.meter.recordBatch(result, paramsByCustomId[result.custom_id]);
}
```

## What the numbers mean

- **in** is `input_tokens`: prompt tokens at full price. **write** is `cache_creation_input_tokens`
  (1.25x the input price for the 5-minute cache, 2x for the 1-hour one). **read** is
  `cache_read_input_tokens`. **out** is `output_tokens`, thinking included. The whole prompt is
  in + write + read.
- **saved**: the same call with no caching at all, minus what it cost. The first cached call writes
  the cache, so it costs more than no caching: its "saved" is negative.
- **hit rate**: cache reads over the whole prompt, for all the calls.
- **would save**, when a call has no `cache_control` anywhere: an estimate of what caching would save.
  It assumes automatic caching (`cache_control` at the top of the request) with the 5-minute lifetime:
  the part of the prompt that the previous call already sent, unchanged, would be read from the cache,
  and the rest written to it. That fits an agent loop, where every call resends the one before it and
  adds a turn. It knows nothing about other processes sharing your cache, and it can't see the
  minimum-length rule beyond the table in prices.mjs. Treat it as a hint, then turn caching on and
  measure.
- **Warnings**: cache-meter says so when a request asks for caching and nothing is cached (under the
  model's minimum length, 512 tokens on Sonnet 5.5), when cached calls keep writing and never read
  (something before the breakpoint changes on every call, like a timestamp), and when the cache ran out
  between two calls (more than 5 minutes apart).

Prices are list prices for the Claude API, checked on the date at the top of prices.mjs. Your bill is
what the Console says, not what this says: discounts, long-context pricing, data residency and
server-tool fees aren't in it. `client.beta.messages` and `create()` with `stream: true` aren't metered;
`client.messages.stream()` is.

## The examples

These are the tests from The Coderlog's video on prompt caching. They run on `claude-sonnet-5-5` with
the till (a small Node.js app, about 45,600 tokens when every file is put in the prompt) as the shared
context. `npm install` first; they read `ANTHROPIC_API_KEY`.

| Command | What it does |
| --- | --- |
| `node examples/price-tag.mjs` | One question three ways: caching off, the first cached call (a write), a second one (a read) |
| `node examples/when-it-loses.mjs` | A prompt under the minimum, a prompt asked once, a 6-minute pause (5-minute against 1-hour cache), a timestamp on top |
| `node examples/batch.mjs all` | 20 code reviews five ways: one at a time with and without caching, and as a Message Batch with no cache, a 1-hour cache, and a warmed 1-hour cache |
| `node examples/race/race.mjs --runs 5` | The race: the same agent on the same coding task, caching off against caching on, 5 runs each (one at a time, taking turns to go first), with hidden checks |

### The race

[examples/race/agent.mjs](examples/race/agent.mjs) is a plain Messages API tool loop (read_file,
edit_file, bash) with the whole till in its system prompt. Caching on is two lines: `cache_control` on
the system prompt, and `cache_control` at the top of the request so the conversation so far is cached
too, turn after turn. Every run starts cold: the first line of the system prompt names the run, so no
run reads another one's cache.

The task is in [examples/race/till/docs/loyalty.md](examples/race/till/docs/loyalty.md): add loyalty
points to the till. Then [examples/race/check.mjs](examples/race/check.mjs) runs 15 checks that the
agent never sees, from the receipt staying the same without the new flag to points on the total after
offers, gift cards and bags left out, and commas in the numbers. The headline number is the
**cost per passing run**: what a side spent, over the runs that passed.

## What it measured

From the video's runs on 2026-10-26: `claude-sonnet-5-5` at the API's default effort, list prices. The
Console bill for all of it came to $16.37, the same as cache-meter's total to the cent.

The race, 5 runs each, one at a time, taking turns to go first:

```
                        A no cache        B cached
passed                  5 of 5            5 of 5
median time             1:26              1:13
median turns            10                9
input at full price     3,189,740         102
cache writes            0                 298,902
cache reads             0                 2,191,708
hit rate                0.0%              88.0%
output tokens           59,075            57,084
spent                   $6.9702           $1.5375
cost per passing run    $1.3940           $0.3075

B costs 4.5x less per passing run.
cache-meter's estimate for A with caching on: $1.6446, 76% less than A spent.
```

A cache read costs 0.05x the input price on Sonnet 5.5, so why only 4.5x? Output can't be cached, and both
sides wrote about the same amount of code: output was 37% of B's bill.

Test 3, twenty code reviews of the till:

| Way | Hit rate | Spent | Per review | Time |
| --- | --- | --- | --- | --- |
| One at a time, no cache | 0.0% | $2.1318 | $0.1066 | 100 s |
| One at a time, cached | 94.9% | $0.5195 | $0.0260 | 102 s |
| Message Batch, no cache | 0.0% | $1.0639 | $0.0532 | 2.71 min to results |
| Message Batch, 1-hour cache | 94.9% | $0.2905 | $0.0145 | 6 min to results |
| Message Batch, cache warmed first | 90.4% | $0.4658 | $0.0233 | 6.01 min to results |

Warming the cache with a normal call before sending the batch didn't help: the batch wrote its own cache
anyway (cache hits in a batch are best-effort). Your numbers will be different (another model, another
prompt, more or fewer turns), which is what the meter is for.

## Tests

```
npm test
```

## License

MIT

# Contributing

The till runs at the counter all day, so changes are small, tested and boring on purpose.

## House rules

- **No dependencies.** Node's standard library only. The tests use `node:test` and
  `node:assert/strict`.
- **Money is whole pence.** Prices are parsed straight into integers (`money.js › parsePrice`) and
  stay integers until they're printed (`formatMoney`). No floats, no `toFixed`, no `Math.round` on
  money.
- **Round once, as late as possible.** VAT is worked out per band, not per line. Splits and shares use
  `money.js › allocate`, so the parts always add up to the whole.
- **Mistakes are TillErrors.** Anything wrong with what the till was given (a flag, a file, a cart
  line) throws a `TillError` with a message the person at the counter can act on. The CLI turns it
  into one `error:` line on stderr, nothing on stdout, and exit code 2. Any other exception is a bug
  and should crash with its stack trace.
- **32 characters.** Every line of a receipt fits the printer: 32 characters or fewer, no trailing
  spaces. Use the helpers in `receipt.js` (`line`, `moneyLine`, `center`, `RULE`) rather than padding
  by hand.
- **The receipt only changes on purpose.** `test/cli.test.js` checks the whole receipt for the sample
  cart, character for character. If your change alters it, say why in the changelog.
- **Docs go with the code.** A new flag or a new block on the receipt gets its own section in
  `docs/` and a line in `README.md › Flags`. docs/architecture.md › Adding a flag has the checklist.

## Style

- ES modules, two-space indents, single quotes, semicolons, lines up to about 110 characters.
- Small functions that take data and return data. Only `cli.js` and `files.js` touch the outside
  world (arguments, files, stdout, stderr).
- A comment says why, or what a function returns when that isn't obvious from its name.
- Tests are named after what the till does, in words: `it('takes the cheapest units off in a 3 for 2')`.

## Before you push

```
npm test
```

All tests pass, and a new feature comes with tests: unit tests for the new module, and CLI tests in
`test/cli.test.js` for what the person at the counter sees.

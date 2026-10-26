# How the till is put together

The till is a pipeline of small modules. Each one takes data and returns data; only `cli.js` and
`files.js` touch the outside world.

```
argv ──► args.js ──► cli.js ──┬─► catalog.js ◄── data/catalog.csv
                              ├─► offers.js  ◄── data/offers.json
                              ├─► store.js   ◄── data/store.json
                              └─► cart.js    ◄── the cart file
                                     │
                                     ▼
                                  bill.js ──► offers.js › applyOffers
                                     │    └─► vat.js › vatSummary
                                     ▼
                     split.js (--split) ─┐
                                     ▼   ▼
                      receipt.js or json.js ──► stdout
```

1. `args.js › parseArgs` turns the command line into an object. It doesn't read any files.
2. `cli.js › main` checks the flag values that can be checked without files (`--split`), then reads
   the catalog, the offers, the store and the cart. Each loader validates its file and throws a
   `TillError` that names the file and the line.
3. `bill.js › makeBill` works out the SUBTOTAL, applies the offers, the TOTAL, and the VAT block.
4. `split.js › splitTotal` shares the TOTAL out when `--split` was given.
5. `receipt.js › renderReceipt` or `json.js › renderJson` turns the bill into text, and `main` writes
   it to stdout in one go.

## Money

Money is always a whole number of pence: £3.20 is `320`. `money.js` has everything that touches it:

- `parsePrice('3.20')` → `320`. A price has exactly two decimals, with or without a `£`.
- `formatMoney(320)` → `'£3.20'`, `formatMoney(-85)` → `'-£0.85'`.
- `vatIn(gross, rate)` → the VAT inside a VAT-inclusive amount, to the nearest penny, halves up.
- `allocate(total, weights)` → `total` shared out in proportion to `weights`, in whole pence that add
  up to `total` exactly (largest remainder; on a tie, the earlier one wins).

## Errors

A `TillError` (errors.js) is a mistake in what the till was given. `main` catches it, prints
`error: <message>` as one line on stderr, prints nothing on stdout, and returns 2. The message names
what to fix: the flag, or the file and line.

Anything else that's thrown is a bug in the till. `main` doesn't catch it, so Node prints the stack
trace and the exit code is 1.

## The receipt

`renderReceipt(bill, store, split)` builds the receipt from blocks, top to bottom: header, items,
totals, VAT, then the optional blocks, then the footer. Each block after the items starts with a
`RULE`. See docs/receipt.md for the layout. Lines are built with `line(label, value)`,
`moneyLine(label, pence)` and `center(text)`, which keep every line at 32 characters or fewer.

## Adding a flag

A new flag touches more places than it looks. In order:

1. `src/args.js`: add it to `FLAGS` (its key, and whether it takes a value), to the starting object
   in `parseArgs`, and to `HELP`. The parsing itself (both `--flag value` and `--flag=value`, given
   twice, no value) comes for free from `FLAGS`.
2. Check the flag's value early in `src/cli.js › main`, before any file is read, the way `--split`
   is, so a typo is reported first.
3. The feature itself, in its own module under `src/` if it's more than a few lines.
4. `src/receipt.js` and `src/json.js` if it changes what's printed. Without the flag, the receipt and
   the JSON must stay exactly as they were.
5. Tests: `test/args.test.js` for parsing, a test file for the new module, and `test/cli.test.js` for
   what's printed, including the mistakes (exit code 2, one `error:` line, nothing on stdout).
6. Docs: `README.md › Flags`, a page in `docs/` if the flag has rules of its own, and `CHANGELOG.md`.

## Tests

`npm test` runs `test/*.test.js` with `node:test`. `test/helpers.js` has what the tests share:
`run(...argv)` runs the CLI in-process and returns `{ code, stdout, stderr }`; `tempFile(name, text)`
writes a throwaway file and returns its path; `sampleCatalog()` loads `data/catalog.csv`.

#!/usr/bin/env node
// The till's command line: till <cart.csv> [flags] (README.md). main() returns the exit code instead of
// exiting, so the tests can run it in-process and see what it printed.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, HELP } from './args.js';
import { loadCatalog } from './catalog.js';
import { loadCart } from './cart.js';
import { loadOffers } from './offers.js';
import { loadStore } from './store.js';
import { makeBill } from './bill.js';
import { parseSplit, splitTotal } from './split.js';
import { renderReceipt } from './receipt.js';
import { renderJson } from './json.js';
import { TillError } from './errors.js';

// The shop's own data files, found next to the code so the till works from any folder
const dataFile = name => fileURLToPath(new URL(`../data/${name}`, import.meta.url));
export const DEFAULTS = {
  catalog: dataFile('catalog.csv'),
  offers: dataFile('offers.json'),
  store: dataFile('store.json'),
};

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

// io: anything with stdout.write and stderr.write (the tests pass their own)
export function main(argv, io = process) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      io.stdout.write(HELP);
      return 0;
    }
    if (args.version) {
      io.stdout.write(`till ${VERSION}\n`);
      return 0;
    }
    // flags first, so a typo in one is reported before any file is read
    const people = args.split === undefined ? null : parseSplit(args.split);
    const catalog = loadCatalog(args.catalog ?? DEFAULTS.catalog);
    const offers = args.noOffers ? [] : loadOffers(args.offers ?? DEFAULTS.offers, catalog);
    const store = loadStore(args.store ?? DEFAULTS.store);
    const bill = makeBill(loadCart(args.cart, catalog), offers);
    const split = people && splitTotal(bill.total, people);
    io.stdout.write(args.json ? renderJson(bill, store, split) : renderReceipt(bill, store, split));
    return 0;
  } catch (err) {
    if (!(err instanceof TillError)) throw err;
    io.stderr.write(`error: ${err.message}\n`);
    return err.exitCode;
  }
}

// Run as a program (node src/cli.js, or the till command), not when a test imports this file
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}

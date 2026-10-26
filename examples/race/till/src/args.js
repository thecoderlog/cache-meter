// Reading the command line (README.md › Flags). Every flag the till knows is in FLAGS, and
// docs/architecture.md › Adding a flag lists everything else a new flag needs.
import { TillError } from './errors.js';

// flag → the key it sets in parseArgs()'s result, and whether it takes a value
export const FLAGS = {
  '--split': { key: 'split', value: true },
  '--json': { key: 'json', value: false },
  '--catalog': { key: 'catalog', value: true },
  '--offers': { key: 'offers', value: true },
  '--store': { key: 'store', value: true },
  '--no-offers': { key: 'noOffers', value: false },
  '--help': { key: 'help', value: false },
  '--version': { key: 'version', value: false },
};

export const HELP = `usage: till <cart.csv> [flags]

Prints a receipt for the cart, with this week's offers taken off.

  --split Asha:2,Ben   split the TOTAL between friends (docs/split.md)
  --json               print the bill as JSON instead (docs/json.md)
  --catalog <file>     products and prices (default data/catalog.csv)
  --offers <file>      this week's offers (default data/offers.json)
  --store <file>       the shop's details (default data/store.json)
  --no-offers          leave the offers out
  --help               show this help
  --version            show the till's version
`;

// → { cart, split, json, catalog, offers, store, noOffers, help, version }. A flag that takes a value
// and wasn't given is undefined; an on/off flag that wasn't given is false. A flag's value can follow
// it (--split Asha,Ben) or be joined to it with = (--split=Asha,Ben).
export function parseArgs(argv) {
  const args = {
    cart: undefined,
    split: undefined,
    json: false,
    catalog: undefined,
    offers: undefined,
    store: undefined,
    noOffers: false,
    help: false,
    version: false,
  };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      if (args.cart !== undefined) throw new TillError(`one cart at a time, not ${args.cart} and ${arg}`);
      args.cart = arg;
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const flag = FLAGS[name];
    if (!flag) throw new TillError(`unknown flag ${name} (see till --help)`);
    if (seen.has(name)) throw new TillError(`${name} is given twice`);
    seen.add(name);
    if (!flag.value) {
      if (eq !== -1) throw new TillError(`${name} doesn't take a value`);
      args[flag.key] = true;
      continue;
    }
    let value = eq === -1 ? argv[i + 1] : arg.slice(eq + 1);
    if (eq === -1) {
      if (value === undefined || value.startsWith('--')) throw new TillError(`${name} needs a value`);
      i++;
    }
    if (value.trim() === '') throw new TillError(`${name} needs a value`);
    args[flag.key] = value;
  }
  if (args.noOffers && args.offers !== undefined) throw new TillError('--offers and --no-offers can\'t go together');
  if (args.cart === undefined && !args.help && !args.version) throw new TillError('no cart file (try: till data/cart.csv)');
  return args;
}

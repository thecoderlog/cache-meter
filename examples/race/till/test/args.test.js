import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FLAGS, HELP, parseArgs } from '../src/args.js';

const NOTHING = {
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

describe('parseArgs', () => {
  it('reads the cart file', () => {
    assert.deepEqual(parseArgs(['data/cart.csv']), { ...NOTHING, cart: 'data/cart.csv' });
  });

  it('reads flags before or after the cart', () => {
    const args = { ...NOTHING, cart: 'c.csv', json: true, split: 'Asha,Ben' };
    assert.deepEqual(parseArgs(['c.csv', '--json', '--split', 'Asha,Ben']), args);
    assert.deepEqual(parseArgs(['--split', 'Asha,Ben', '--json', 'c.csv']), args);
  });

  it('takes a value after the flag or joined to it with =', () => {
    assert.equal(parseArgs(['c.csv', '--catalog', 'other.csv']).catalog, 'other.csv');
    assert.equal(parseArgs(['c.csv', '--catalog=other.csv']).catalog, 'other.csv');
    assert.equal(parseArgs(['c.csv', '--split=Asha:2,Ben']).split, 'Asha:2,Ben');
  });

  it('keeps a value with spaces in it', () => {
    assert.equal(parseArgs(['c.csv', '--store', 'my store.json']).store, 'my store.json');
  });

  it('reads every on/off flag', () => {
    assert.deepEqual(parseArgs(['c.csv', '--json', '--no-offers']), { ...NOTHING, cart: 'c.csv', json: true, noOffers: true });
  });

  it('needs no cart for --help or --version', () => {
    assert.equal(parseArgs(['--help']).help, true);
    assert.equal(parseArgs(['--version']).version, true);
  });

  const mistake = (argv, message) => assert.throws(() => parseArgs(argv), { name: 'TillError', message });

  it('turns down a flag it does not know', () => {
    mistake(['c.csv', '--jsn'], 'unknown flag --jsn (see till --help)');
    mistake(['c.csv', '--jsn=1'], 'unknown flag --jsn (see till --help)');
  });

  it('turns down a flag given twice', () => {
    mistake(['c.csv', '--json', '--json'], '--json is given twice');
    mistake(['c.csv', '--split', 'A', '--split=B'], '--split is given twice');
  });

  it('turns down a flag with no value', () => {
    mistake(['c.csv', '--split'], '--split needs a value');
    mistake(['c.csv', '--split', '--json'], '--split needs a value');
    mistake(['c.csv', '--split='], '--split needs a value');
    mistake(['c.csv', '--split', ' '], '--split needs a value');
  });

  it('turns down a value for an on/off flag', () => {
    mistake(['c.csv', '--json=yes'], "--json doesn't take a value");
  });

  it('turns down two carts', () => {
    mistake(['a.csv', 'b.csv'], 'one cart at a time, not a.csv and b.csv');
  });

  it('turns down no cart at all', () => {
    mistake([], 'no cart file (try: till data/cart.csv)');
    mistake(['--json'], 'no cart file (try: till data/cart.csv)');
  });

  it('turns down --offers with --no-offers', () => {
    mistake(['c.csv', '--no-offers', '--offers', 'o.json'], "--offers and --no-offers can't go together");
  });
});

describe('FLAGS and HELP', () => {
  it('has every flag in the help', () => {
    for (const flag of Object.keys(FLAGS)) assert.ok(HELP.includes(flag), `${flag} is not in HELP`);
  });

  it('sets a key that parseArgs starts with', () => {
    const start = parseArgs(['c.csv']);
    for (const [flag, { key }] of Object.entries(FLAGS)) assert.ok(key in start, `${flag} sets ${key}`);
  });
});

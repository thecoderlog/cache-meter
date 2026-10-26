import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cartText, dataFile, run, tempFile } from './helpers.js';
import { VERSION } from '../src/cli.js';

const CART = dataFile('cart.csv');

// The whole receipt for data/cart.csv. It only changes on purpose (CONTRIBUTING.md).
const SAMPLE_RECEIPT = [
    '        TILL & CO MARKET',
    '        14 Corn Exchange',
    '         Leeds LS1 7BR',
    '     VAT No. GB 284 1937 06',
    '--------------------------------',
    'Sourdough loaf             £3.20',
    'Butter croissant           £1.70',
    '  2 x £0.85',
    'Pain au chocolat           £0.95',
    'Oat drink 1l               £3.30',
    '  2 x £1.65',
    'Mature cheddar 400g        £3.75',
    'Braeburn apples x6         £1.99',
    'Ground coffee 227g         £3.95',
    'Cola 2l                    £4.30',
    '  2 x £2.15',
    'Ready salted crisps 6pk    £1.65',
    'Sea salt crisps 150g       £1.95',
    'Chicken & bacon sandwich   £3.10',
    'Cola can 330ml             £0.95',
    'Fruit pot                  £1.10',
    'Toothpaste 75ml            £1.60',
    'Nicotine patches x7       £10.50',
    'Carrier bag                £0.20',
    '  2 x £0.10',
    '--------------------------------',
    'SUBTOTAL                  £44.19',
    'Pastries 3 for 2          -£0.85',
    'Crisps 2 for £3           -£0.60',
    'Meal deal                 -£1.30',
    'Cola 2l 2 for £3          -£1.30',
    'TOTAL                     £40.14',
    '--------------------------------',
    'VAT 20% on £8.51           £1.42',
    'VAT 5% on £10.50           £0.50',
    'VAT 0% on £21.13           £0.00',
    'VAT TOTAL                  £1.92',
    '--------------------------------',
    ' Thank you for shopping with us',
].join('\n') + '\n';

// A mistake prints one error line, nothing else, and exits with 2 (docs/architecture.md › Errors)
function assertMistake(result, message) {
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `error: ${message}\n`);
}

describe('till <cart>', () => {
  it('prints the sample receipt', () => {
    const result = run(CART);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, SAMPLE_RECEIPT);
  });

  it('works as a program too', () => {
    const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
    const ok = spawnSync(process.execPath, [cli, CART], { encoding: 'utf8' });
    assert.equal(ok.status, 0);
    assert.equal(ok.stdout, SAMPLE_RECEIPT);
    const bad = spawnSync(process.execPath, [cli, CART, '--jsn'], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
    assert.equal(bad.stdout, '');
    assert.equal(bad.stderr, 'error: unknown flag --jsn (see till --help)\n');
  });
});

describe('--split', () => {
  it('adds the SPLIT block before the footer', () => {
    const result = run(CART, '--split', 'Asha:2,Ben,Chen');
    assert.equal(result.code, 0);
    assert.deepEqual(result.stdout.trimEnd().split('\n').slice(-8), [
      'VAT TOTAL                  £1.92',
      '--------------------------------',
      'SPLIT',
      'Asha                      £20.07',
      'Ben                       £10.04',
      'Chen                      £10.03',
      '--------------------------------',
      ' Thank you for shopping with us',
    ]);
  });

  it('leaves the rest of the receipt as it was', () => {
    const plain = run(CART).stdout.split('\n');
    const split = run(CART, '--split', 'Asha,Ben').stdout.split('\n');
    assert.deepEqual(split.slice(0, plain.length - 3), plain.slice(0, -3));
  });

  it('turns down a bad split before reading any file', () => {
    assertMistake(run('no-such-cart.csv', '--split', 'Asha,,Ben'), '--split: an empty name in "Asha,,Ben"');
  });
});

describe('--json', () => {
  it('prints the bill as JSON, in pence', () => {
    const result = run(CART, '--json');
    assert.equal(result.code, 0);
    const bill = JSON.parse(result.stdout);
    assert.equal(bill.store, 'TILL & CO MARKET');
    assert.equal(bill.lines.length, 16);
    assert.deepEqual(bill.lines[1], { sku: '1004', name: 'Butter croissant', qty: 2, price: 85, amount: 170, vat: 'Z' });
    assert.equal(bill.subtotal, 4419);
    assert.deepEqual(bill.offers[2], { id: 'meal-deal', label: 'Meal deal', saving: 130 });
    assert.equal(bill.savings, 405);
    assert.equal(bill.total, 4014);
    assert.deepEqual(bill.vat, [
      { band: 'S', rate: 20, gross: 851, vat: 142 },
      { band: 'R', rate: 5, gross: 1050, vat: 50 },
      { band: 'Z', rate: 0, gross: 2113, vat: 0 },
    ]);
    assert.equal(bill.vatTotal, 192);
  });

  it('has no split field without --split', () => {
    assert.equal('split' in JSON.parse(run(CART, '--json').stdout), false);
  });

  it('has the split with --split', () => {
    const bill = JSON.parse(run(CART, '--json', '--split', 'Asha:2,Ben').stdout);
    assert.deepEqual(bill.split, [{ name: 'Asha', shares: 2, owes: 2676 }, { name: 'Ben', shares: 1, owes: 1338 }]);
  });

  it('is indented and ends with a newline', () => {
    const { stdout } = run(CART, '--json');
    assert.ok(stdout.startsWith('{\n  "store": "TILL & CO MARKET",\n'));
    assert.ok(stdout.endsWith('}\n'));
  });
});

describe('--no-offers', () => {
  it('prints the receipt at shelf prices', () => {
    const { code, stdout } = run(CART, '--no-offers');
    assert.equal(code, 0);
    assert.match(stdout, /^SUBTOTAL {18}£44\.19\nTOTAL {21}£44\.19$/m);
    assert.doesNotMatch(stdout, /Meal deal/);
  });
});

describe('--catalog, --offers and --store', () => {
  it('read other files', () => {
    const catalog = tempFile('catalog.csv', 'sku,name,price,vat,category\nA1,Apple,0.40,Z,produce\nB1,Beer,2.00,S,drinks\n');
    const offers = tempFile('offers.json', JSON.stringify([
      { id: 'beer', type: 'fixed', label: 'Beer 2 for £3', skus: ['B1'], count: 2, price: '3.00' },
    ]));
    const store = tempFile('store.json', JSON.stringify({ name: 'CORNER SHOP', vatNumber: 'GB 1' }));
    const cart = tempFile('cart.csv', cartText(['A1', 3], ['B1', 2]));
    const { code, stdout } = run(cart, '--catalog', catalog, '--offers', offers, '--store', store);
    assert.equal(code, 0);
    assert.equal(stdout, [
      '          CORNER SHOP',
      '          VAT No. GB 1',
      '--------------------------------',
      'Apple                      £1.20',
      '  3 x £0.40',
      'Beer                       £4.00',
      '  2 x £2.00',
      '--------------------------------',
      'SUBTOTAL                   £5.20',
      'Beer 2 for £3             -£1.00',
      'TOTAL                      £4.20',
      '--------------------------------',
      'VAT 20% on £3.00           £0.50',
      'VAT 0% on £1.20            £0.00',
      'VAT TOTAL                  £0.50',
      '',
    ].join('\n'));
  });
});

describe('--help and --version', () => {
  it('prints the help', () => {
    const { code, stdout } = run('--help');
    assert.equal(code, 0);
    assert.ok(stdout.startsWith('usage: till <cart.csv> [flags]\n'));
  });

  it('prints the version', () => {
    assert.deepEqual(run('--version'), { code: 0, stdout: `till ${VERSION}\n`, stderr: '' });
    assert.equal(VERSION, '0.9.0');
  });
});

describe('mistakes', () => {
  it('a cart file that is not there', () => {
    assertMistake(run('no-such-cart.csv'), 'no such file: no-such-cart.csv');
  });

  it('a cart line with a SKU that is not in the catalog', () => {
    const cart = tempFile('bad-sku.csv', cartText(['1001', 1], ['4242', 1]));
    assertMistake(run(cart), `${cart} line 3: no product with sku 4242`);
  });

  it('a cart line with a bad quantity', () => {
    const cart = tempFile('bad-qty.csv', cartText(['1001', 'two']));
    assertMistake(run(cart), `${cart} line 2: qty must be a whole number of 1 or more, not "two"`);
  });

  it('an offers file that is not JSON', () => {
    const offers = tempFile('broken.json', '[{"id": ');
    const result = run(CART, '--offers', offers);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^error: .*broken\.json is not valid JSON \(.*\)\n$/);
  });

  it('a flag it does not know', () => {
    assertMistake(run(CART, '--loyalty'), 'unknown flag --loyalty (see till --help)');
  });

  it('no cart', () => {
    assertMistake(run(), 'no cart file (try: till data/cart.csv)');
  });
});

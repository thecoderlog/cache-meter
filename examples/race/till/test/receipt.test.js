import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { center, line, moneyLine, renderReceipt, RULE, WIDTH } from '../src/receipt.js';
import { makeBill } from '../src/bill.js';
import { parseCart } from '../src/cart.js';
import { parseOffers } from '../src/offers.js';
import { parseSplit, splitTotal } from '../src/split.js';
import { cartText, sampleCatalog } from './helpers.js';

const catalog = sampleCatalog();
const store = { name: 'TEST SHOP', address: ['1 High St'], vatNumber: 'GB 123', footer: 'Thanks' };
const PASTRIES = { id: 'p', type: 'multibuy', label: 'Pastries 3 for 2', skus: ['1004', '1005'], buy: 3, pay: 2 };
const bill = (rows, offers = []) => makeBill(parseCart(cartText(...rows), catalog), parseOffers(offers, catalog));

describe('line', () => {
  it('puts the label on the left and the value on the right, 32 wide', () => {
    assert.equal(line('TOTAL', '£40.14'), 'TOTAL                     £40.14');
    assert.equal(line('TOTAL', '£40.14').length, WIDTH);
  });

  it('cuts a long label short and keeps one space before the value', () => {
    assert.equal(line('Ham, cheese & pickle sandwich', '£3.30'), 'Ham, cheese & pickle sandw £3.30');
  });

  it('never ends the cut label in a space', () => {
    // cut at 26 characters, that's "Chocolate digestives 300g " with a space at the end
    assert.equal(line('Chocolate digestives 300g extra', '£1.40'), 'Chocolate digestives 300g  £1.40');
  });

  it('never cuts the value', () => {
    assert.equal(line('A', '£1234567.89'), 'A' + ' '.repeat(20) + '£1234567.89');
  });
});

describe('moneyLine', () => {
  it('prints pence as money, negative for savings', () => {
    assert.equal(moneyLine('Meal deal', -130), 'Meal deal                 -£1.30');
  });
});

describe('center', () => {
  it('puts the spaces on the left, with the odd one out on the right', () => {
    assert.equal(center('TILL & CO MARKET'), ' '.repeat(8) + 'TILL & CO MARKET');
    assert.equal(center('Leeds LS1 7BR'), ' '.repeat(9) + 'Leeds LS1 7BR');
  });

  it('leaves text of the full width alone', () => {
    assert.equal(center(RULE), RULE);
  });
});

describe('renderReceipt', () => {
  const lines = text => text.trimEnd().split('\n');

  it('prints the blocks in order: header, items, totals, VAT, footer', () => {
    const text = renderReceipt(bill([['1004', 2], ['1005', 1]], [PASTRIES]), store);
    assert.deepEqual(lines(text), [
      '           TEST SHOP',
      '           1 High St',
      '         VAT No. GB 123',
      RULE,
      'Butter croissant           £1.70',
      '  2 x £0.85',
      'Pain au chocolat           £0.95',
      RULE,
      'SUBTOTAL                   £2.65',
      'Pastries 3 for 2          -£0.85',
      'TOTAL                      £1.80',
      RULE,
      'VAT 0% on £1.80            £0.00',
      'VAT TOTAL                  £0.00',
      RULE,
      '             Thanks',
    ]);
  });

  it('ends with a newline', () => {
    assert.match(renderReceipt(bill([['1001', 1]]), store), /£0\.00\n-+\n +Thanks\n$/);
  });

  it('puts the SPLIT block after the VAT block and before the footer', () => {
    const b = bill([['1001', 1], ['6003', 1]]);
    const text = renderReceipt(b, store, splitTotal(b.total, parseSplit('Asha,Ben')));
    assert.deepEqual(lines(text).slice(-9), [
      'VAT 20% on £2.15           £0.36',
      'VAT 0% on £3.20            £0.00',
      'VAT TOTAL                  £0.36',
      RULE,
      'SPLIT',
      'Asha                       £2.68',
      'Ben                        £2.67',
      RULE,
      '             Thanks',
    ]);
  });

  it('leaves the footer out when there is none', () => {
    const text = renderReceipt(bill([['1001', 1]]), { ...store, footer: '' });
    assert.equal(lines(text).at(-1), 'VAT TOTAL                  £0.00');
  });

  it('keeps every line to 32 characters, with no spaces at the end', () => {
    const rows = [...catalog.keys()].map(sku => [sku, 3]);
    const b = bill(rows, [PASTRIES]);
    const text = renderReceipt(b, store, splitTotal(b.total, parseSplit('Asha:2,Ben,Christopher-Montgomery')));
    for (const row of lines(text)) {
      assert.ok([...row].length <= WIDTH, `too long: "${row}"`);
      assert.equal(row, row.trimEnd(), `ends in a space: "${row}"`);
    }
  });
});

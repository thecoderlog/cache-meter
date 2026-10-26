import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCart } from '../src/cart.js';
import { TillError } from '../src/errors.js';
import { cartText, sampleCatalog } from './helpers.js';

const catalog = sampleCatalog();

describe('parseCart', () => {
  it('turns each row into a receipt line with its amount', () => {
    const [line] = parseCart(cartText(['1004', 2]), catalog);
    assert.deepEqual(line, {
      sku: '1004',
      name: 'Butter croissant',
      price: 85,
      vat: 'Z',
      category: 'bakery',
      qty: 2,
      amount: 170,
    });
  });

  it('keeps the cart order', () => {
    const lines = parseCart(cartText(['6003', 1], ['1001', 1], ['7001', 1]), catalog);
    assert.deepEqual(lines.map(line => line.sku), ['6003', '1001', '7001']);
  });

  it('adds up a SKU that is on two rows, where it first appeared', () => {
    const lines = parseCart(cartText(['1004', 1], ['1001', 1], ['1004', 2]), catalog);
    assert.deepEqual(lines.map(line => [line.sku, line.qty, line.amount]), [['1004', 3, 255], ['1001', 1, 320]]);
  });

  it('turns down a SKU that is not in the catalog', () => {
    assert.throws(() => parseCart(cartText(['1001', 1], ['9999', 1]), catalog, 'cart.csv'), {
      name: 'TillError',
      message: 'cart.csv line 3: no product with sku 9999',
    });
  });

  it('turns down a quantity that is not a whole number of 1 or more', () => {
    for (const qty of ['0', '-1', '1.5', 'two', '', '01']) {
      assert.throws(() => parseCart(cartText(['1001', qty]), catalog), TillError, `qty "${qty}"`);
    }
  });

  it('turns down a cart with nothing in it', () => {
    assert.throws(() => parseCart('sku,qty\n', catalog, 'cart.csv'), { message: 'cart.csv has no items' });
  });
});

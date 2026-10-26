import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeBill } from '../src/bill.js';
import { loadCart, parseCart } from '../src/cart.js';
import { loadOffers } from '../src/offers.js';
import { cartText, dataFile, sampleCatalog } from './helpers.js';

const catalog = sampleCatalog();
const offers = loadOffers(dataFile('offers.json'), catalog);

describe('makeBill', () => {
  it('works out the sample cart', () => {
    const bill = makeBill(loadCart(dataFile('cart.csv'), catalog), offers);
    assert.equal(bill.subtotal, 4419);
    assert.deepEqual(bill.offers.map(offer => [offer.id, offer.saving]), [
      ['pastries-3for2', 85],
      ['crisps-2for3', 60],
      ['meal-deal', 130],
      ['cola-2for3', 130],
    ]);
    assert.equal(bill.savings, 405);
    assert.equal(bill.total, 4014);
    assert.equal(bill.vatTotal, 192);
  });

  it('charges shelf prices when no offer applies', () => {
    const bill = makeBill(parseCart(cartText(['1001', 1], ['2005', 2]), catalog), offers);
    assert.deepEqual(bill.offers, []);
    assert.equal(bill.savings, 0);
    assert.equal(bill.total, bill.subtotal);
    assert.equal(bill.total, 1070);
  });

  it('works without offers at all', () => {
    const bill = makeBill(loadCart(dataFile('cart.csv'), catalog));
    assert.equal(bill.total, 4419);
  });
});

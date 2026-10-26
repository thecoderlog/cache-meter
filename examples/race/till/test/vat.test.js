import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { savingByBand, vatSummary } from '../src/vat.js';
import { applyOffers, loadOffers } from '../src/offers.js';
import { loadCart, parseCart } from '../src/cart.js';
import { sum } from '../src/money.js';
import { cartText, dataFile, sampleCatalog } from './helpers.js';

const catalog = sampleCatalog();
const sampleOffers = loadOffers(dataFile('offers.json'), catalog);

describe('savingByBand', () => {
  it('shares a saving across bands by shelf price, in whole pence', () => {
    const offer = {
      saving: 130,
      units: [
        { sku: '8001', price: 310, vat: 'Z' },
        { sku: '6004', price: 95, vat: 'S' },
        { sku: '7009', price: 110, vat: 'Z' },
      ],
    };
    // 23.98p and 106.02p: the spare penny goes to S (docs/vat.md › Offers and VAT)
    assert.deepEqual(savingByBand(offer), { S: 24, Z: 106 });
  });

  it('puts the whole saving on one band when every unit is in it', () => {
    const offer = { saving: 60, units: [{ sku: '7001', price: 165, vat: 'S' }, { sku: '7002', price: 195, vat: 'S' }] };
    assert.deepEqual(savingByBand(offer), { S: 60 });
  });
});

describe('vatSummary', () => {
  it('works out the VAT once per band, after offers', () => {
    const lines = loadCart(dataFile('cart.csv'), catalog);
    const rows = vatSummary(lines, applyOffers(lines, sampleOffers));
    assert.deepEqual(rows, [
      { band: 'S', rate: 20, gross: 851, vat: 142 },
      { band: 'R', rate: 5, gross: 1050, vat: 50 },
      { band: 'Z', rate: 0, gross: 2113, vat: 0 },
    ]);
  });

  it('has grosses that add up to what the customer pays', () => {
    const lines = loadCart(dataFile('cart.csv'), catalog);
    const applied = applyOffers(lines, sampleOffers);
    const paid = sum(lines.map(line => line.amount)) - sum(applied.map(offer => offer.saving));
    assert.equal(sum(vatSummary(lines, applied).map(row => row.gross)), paid);
  });

  it('leaves out a band with nothing in it', () => {
    const lines = parseCart(cartText(['1001', 1], ['6003', 1]), catalog);
    assert.deepEqual(vatSummary(lines, []).map(row => row.band), ['S', 'Z']);
  });

  it('is not the same as rounding each line', () => {
    // seven £0.95 cans: 15.83p of VAT in each, which would round to 16p, and 7 × 16p is 112p.
    // Worked out once on £6.65 it's 110.83p, so 111p.
    const lines = parseCart(cartText(['6004', 7]), catalog);
    assert.deepEqual(vatSummary(lines, []), [{ band: 'S', rate: 20, gross: 665, vat: 111 }]);
  });
});

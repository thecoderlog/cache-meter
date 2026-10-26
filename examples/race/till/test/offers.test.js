import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyOffers, parseOffers } from '../src/offers.js';
import { parseCart } from '../src/cart.js';
import { TillError } from '../src/errors.js';
import { cartText, dataFile, sampleCatalog } from './helpers.js';
import { loadOffers } from '../src/offers.js';

const catalog = sampleCatalog();
const cart = (...rows) => parseCart(cartText(...rows), catalog);

const PASTRIES = { id: 'pastries', type: 'multibuy', label: 'Pastries 3 for 2', skus: ['1004', '1005', '1006'], buy: 3, pay: 2 };
const CRISPS = { id: 'crisps', type: 'fixed', label: 'Crisps 2 for £3', skus: ['7001', '7002'], count: 2, price: '3.00' };
const MEAL = {
  id: 'meal',
  type: 'mealdeal',
  label: 'Meal deal',
  price: '3.85',
  groups: [['8001', '8002', '8003'], ['6004', '6007'], ['7003', '7009']],
};
const offers = (...raw) => parseOffers(raw, catalog);
const savings = (lines, list) => applyOffers(lines, list).map(offer => [offer.id, offer.saving]);

describe('multibuy', () => {
  it('makes the cheapest unit in a group of three free', () => {
    // £0.95, £0.85, £0.85: one croissant is free
    assert.deepEqual(savings(cart(['1004', 2], ['1005', 1]), offers(PASTRIES)), [['pastries', 85]]);
  });

  it('mixes any of the listed SKUs', () => {
    // £1.40, £0.95, £0.85
    assert.deepEqual(savings(cart(['1004', 1], ['1005', 1], ['1006', 1]), offers(PASTRIES)), [['pastries', 85]]);
  });

  it('groups the most expensive units first', () => {
    // £1.40, £1.40, £0.95 | £0.85, £0.85, £0.85: the free ones are £0.95 and £0.85
    assert.deepEqual(savings(cart(['1006', 2], ['1005', 1], ['1004', 3]), offers(PASTRIES)), [['pastries', 180]]);
  });

  it('gives nothing for a group that is not full', () => {
    assert.deepEqual(savings(cart(['1004', 2]), offers(PASTRIES)), []);
    // four units: one full group, and the fourth (the cheapest) is paid for
    assert.deepEqual(savings(cart(['1006', 3], ['1004', 1]), offers(PASTRIES)), [['pastries', 140]]);
  });
});

describe('fixed price', () => {
  it('charges the fixed price for each full group', () => {
    // £1.95 + £1.65 = £3.60 for £3
    assert.deepEqual(savings(cart(['7001', 1], ['7002', 1]), offers(CRISPS)), [['crisps', 60]]);
    // £1.95 + £1.95 and £1.65 + £1.65
    assert.deepEqual(savings(cart(['7001', 2], ['7002', 2]), offers(CRISPS)), [['crisps', 120]]);
  });

  it('leaves a group alone when its shelf prices are already lower', () => {
    const twoForFive = { ...CRISPS, id: 'dear', price: '5.00' };
    assert.deepEqual(savings(cart(['7001', 1], ['7002', 1]), offers(twoForFive)), []);
  });
});

describe('meal deal', () => {
  it('makes a meal from one of each group', () => {
    // £3.10 + £0.95 + £1.10 = £5.15 for £3.85
    assert.deepEqual(savings(cart(['8001', 1], ['6004', 1], ['7009', 1]), offers(MEAL)), [['meal', 130]]);
  });

  it('puts the most expensive main, drink and snack in the first meal', () => {
    // meal 1: £3.25 + £1.35 + £1.35 = £5.95; meal 2: £2.40 + £0.95 + £1.10 = £4.45
    const lines = cart(['8002', 1], ['8003', 1], ['6004', 1], ['6007', 1], ['7003', 1], ['7009', 1]);
    assert.deepEqual(savings(lines, offers(MEAL)), [['meal', 210 + 60]]);
  });

  it('needs something from every group', () => {
    assert.deepEqual(savings(cart(['8001', 2], ['6004', 2]), offers(MEAL)), []);
  });

  it('only counts a meal that is cheaper than its shelf prices', () => {
    const dearMeal = { ...MEAL, price: '9.99' };
    assert.deepEqual(savings(cart(['8001', 1], ['6004', 1], ['7009', 1]), offers(dearMeal)), []);
  });
});

describe('applyOffers', () => {
  it('lets each unit count towards one offer only, in file order', () => {
    // the cola can goes to the first offer that wants it
    const canDeal = { id: 'cans', type: 'fixed', label: 'Cans 2 for £1', skus: ['6004'], count: 2, price: '1.00' };
    const lines = cart(['8001', 1], ['6004', 2], ['7009', 1]);
    assert.deepEqual(savings(lines, offers(MEAL, canDeal)), [['meal', 130]]);
    assert.deepEqual(savings(lines, offers(canDeal, MEAL)), [['cans', 90]]);
  });

  it('says which units each offer used', () => {
    const [applied] = applyOffers(cart(['8001', 1], ['6004', 1], ['7009', 1]), offers(MEAL));
    assert.deepEqual(applied.units, [
      { sku: '8001', price: 310, vat: 'Z' },
      { sku: '6004', price: 95, vat: 'S' },
      { sku: '7009', price: 110, vat: 'Z' },
    ]);
  });

  it('leaves the cart lines as they were', () => {
    const lines = cart(['1004', 3]);
    const before = structuredClone(lines);
    applyOffers(lines, offers(PASTRIES));
    assert.deepEqual(lines, before);
  });

  it('applies nothing when there are no offers', () => {
    assert.deepEqual(applyOffers(cart(['1004', 3]), []), []);
  });
});

describe('parseOffers', () => {
  it('reads the sample offers', () => {
    const list = loadOffers(dataFile('offers.json'), catalog);
    assert.deepEqual(list.map(offer => offer.id), ['pastries-3for2', 'crisps-2for3', 'meal-deal', 'cola-2for3']);
    assert.equal(list[2].price, 385);
  });

  const mistake = (raw, message) => assert.throws(() => parseOffers([raw], catalog, 'offers.json'), { name: 'TillError', message });

  it('turns down an unknown type', () => {
    mistake({ ...PASTRIES, type: 'bogof' }, 'offers.json offer 1 (pastries): unknown type "bogof"');
  });

  it('turns down an offer with a field missing', () => {
    const { pay, ...noPay } = PASTRIES;
    mistake(noPay, 'offers.json offer 1 (pastries) has no pay');
    mistake({ ...PASTRIES, label: '' }, 'offers.json offer 1 (pastries) has no label');
  });

  it('turns down a SKU that is not in the catalog', () => {
    mistake({ ...PASTRIES, skus: ['1004', '4242'] }, 'offers.json offer 1 (pastries): no product with sku 4242');
  });

  it('turns down a multibuy that saves nothing', () => {
    mistake({ ...PASTRIES, pay: 3 }, 'offers.json offer 1 (pastries): pay must be less than buy');
  });

  it('turns down a meal deal with a SKU in two groups', () => {
    mistake({ ...MEAL, groups: [['8001'], ['6004', '8001']] }, 'offers.json offer 1 (meal): a sku is in two groups');
  });

  it('turns down two offers with the same id', () => {
    assert.throws(() => parseOffers([PASTRIES, PASTRIES], catalog), TillError);
  });

  it('turns down a file that is not a list', () => {
    assert.throws(() => parseOffers({ offers: [] }, catalog, 'offers.json'), { message: 'offers.json must be a JSON array of offers' });
  });
});

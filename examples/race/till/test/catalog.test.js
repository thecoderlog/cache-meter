import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalog } from '../src/catalog.js';
import { TillError } from '../src/errors.js';
import { sampleCatalog } from './helpers.js';

const HEADER = 'sku,name,price,vat,category\n';

describe('parseCatalog', () => {
  it('reads every product by SKU, with the price in pence', () => {
    const catalog = parseCatalog(HEADER + '1001,Sourdough loaf,3.20,Z,bakery\n6003,Cola 2l,2.15,S,drinks\n');
    assert.deepEqual(catalog.get('1001'), { sku: '1001', name: 'Sourdough loaf', price: 320, vat: 'Z', category: 'bakery' });
    assert.equal(catalog.get('6003').price, 215);
    assert.equal(catalog.size, 2);
  });

  it('lowercases the category', () => {
    assert.equal(parseCatalog(HEADER + '1,Gift card,10.00,Z,GiftCard\n').get('1').category, 'giftcard');
  });

  it('turns down a SKU that appears twice', () => {
    assert.throws(() => parseCatalog(HEADER + '1,A,1.00,Z,x\n1,B,2.00,Z,x\n', 'catalog.csv'), {
      name: 'TillError',
      message: 'catalog.csv line 3: sku 1 appears twice',
    });
  });

  it('turns down a band that is not S, R or Z', () => {
    assert.throws(() => parseCatalog(HEADER + '1,A,1.00,X,x\n', 'catalog.csv'), {
      message: 'catalog.csv line 2: unknown VAT band "X" (use S, R or Z)',
    });
  });

  it('turns down a price that is not two decimals', () => {
    assert.throws(() => parseCatalog(HEADER + '1,A,1.5,Z,x\n'), { message: 'not a price for sku 1: 1.5' });
  });

  it('turns down an empty SKU or name', () => {
    assert.throws(() => parseCatalog(HEADER + ',A,1.00,Z,x\n'), TillError);
    assert.throws(() => parseCatalog(HEADER + '1,,1.00,Z,x\n'), TillError);
  });

  it('turns down a category that is not a word', () => {
    assert.throws(() => parseCatalog(HEADER + '1,A,1.00,Z,dry goods\n'), TillError);
    assert.throws(() => parseCatalog(HEADER + '1,A,1.00,Z,\n'), TillError);
  });
});

describe('the sample catalog', () => {
  const catalog = sampleCatalog();

  it('loads', () => {
    assert.equal(catalog.size, 97);
  });

  it('has the sandwich with a comma in its name', () => {
    assert.equal(catalog.get('8006').name, 'Ham, cheese & pickle sandwich');
  });

  it('has gift cards and bags', () => {
    assert.equal(catalog.get('15002').category, 'giftcard');
    assert.equal(catalog.get('16001').category, 'bag');
  });
});

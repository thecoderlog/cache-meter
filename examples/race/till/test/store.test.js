import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadStore, parseStore } from '../src/store.js';
import { dataFile } from './helpers.js';

const STORE = { name: 'TILL & CO MARKET', address: ['14 Corn Exchange'], vatNumber: 'GB 284 1937 06', footer: 'Thanks' };

describe('parseStore', () => {
  it('reads the sample store', () => {
    assert.deepEqual(loadStore(dataFile('store.json')), {
      name: 'TILL & CO MARKET',
      address: ['14 Corn Exchange', 'Leeds LS1 7BR'],
      vatNumber: 'GB 284 1937 06',
      footer: 'Thank you for shopping with us',
    });
  });

  it('takes a store with no address or footer', () => {
    const { address, footer, ...bare } = STORE;
    assert.deepEqual(parseStore(bare), { ...bare, address: [], footer: '' });
  });

  it('needs a name and a VAT number', () => {
    assert.throws(() => parseStore({ ...STORE, name: '' }, 'store.json'), { name: 'TillError', message: 'store.json: name must be some text' });
    assert.throws(() => parseStore({ ...STORE, vatNumber: undefined }, 'store.json'), { name: 'TillError' });
  });

  it('turns down a line that will not fit on the receipt', () => {
    assert.throws(() => parseStore({ ...STORE, footer: 'x'.repeat(33) }, 'store.json'), {
      message: 'store.json: footer is longer than 32 characters',
    });
  });

  it('turns down an address that is not a list of lines', () => {
    assert.throws(() => parseStore({ ...STORE, address: '14 Corn Exchange' }, 'store.json'), {
      message: 'store.json: address must be a list of lines',
    });
  });

  it('turns down a file that is not an object', () => {
    assert.throws(() => parseStore([STORE], 'store.json'), { message: 'store.json must be a JSON object' });
  });
});

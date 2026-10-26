import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSplit, splitTotal } from '../src/split.js';
import { sum } from '../src/money.js';

describe('parseSplit', () => {
  it('reads names and shares', () => {
    assert.deepEqual(parseSplit('Asha:2,Ben,Chen'), [
      { name: 'Asha', shares: 2 },
      { name: 'Ben', shares: 1 },
      { name: 'Chen', shares: 1 },
    ]);
  });

  it('trims spaces around names and shares', () => {
    assert.deepEqual(parseSplit(' Asha : 3 , Ben '), [{ name: 'Asha', shares: 3 }, { name: 'Ben', shares: 1 }]);
  });

  it('takes one person on their own', () => {
    assert.deepEqual(parseSplit('Asha'), [{ name: 'Asha', shares: 1 }]);
  });

  it('turns down an empty name', () => {
    assert.throws(() => parseSplit('Asha,,Ben'), { name: 'TillError', message: '--split: an empty name in "Asha,,Ben"' });
    assert.throws(() => parseSplit(':2'), { name: 'TillError' });
  });

  it('turns down a name given twice', () => {
    assert.throws(() => parseSplit('Asha,Ben,Asha:2'), { message: '--split: Asha appears twice' });
  });

  it('turns down shares that are not a whole number of 1 or more', () => {
    for (const shares of ['0', '-1', '1.5', 'two', '']) {
      assert.throws(() => parseSplit(`Asha:${shares},Ben`), { name: 'TillError' }, `shares "${shares}"`);
    }
    assert.throws(() => parseSplit('Asha:0,Ben'), {
      message: '--split: shares for Asha must be a whole number of 1 or more, not "0"',
    });
  });
});

describe('splitTotal', () => {
  it('shares the total by shares, in whole pence', () => {
    const split = splitTotal(4014, parseSplit('Asha:2,Ben,Chen'));
    assert.deepEqual(split.map(person => [person.name, person.owes]), [['Asha', 2007], ['Ben', 1004], ['Chen', 1003]]);
  });

  it('always adds up to the total', () => {
    for (const total of [1, 2, 99, 4014, 10001]) {
      assert.equal(sum(splitTotal(total, parseSplit('A:3,B,C:2,D')).map(person => person.owes)), total);
    }
  });

  it('gives the spare penny to the first of two people who tie', () => {
    assert.deepEqual(splitTotal(101, parseSplit('Asha,Ben')).map(person => person.owes), [51, 50]);
  });
});

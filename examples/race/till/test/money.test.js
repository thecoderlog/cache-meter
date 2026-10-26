import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, formatMoney, parsePrice, sum, vatIn } from '../src/money.js';
import { TillError } from '../src/errors.js';

describe('parsePrice', () => {
  it('reads pounds and pence into whole pence', () => {
    assert.equal(parsePrice('3.20'), 320);
    assert.equal(parsePrice('0.05'), 5);
    assert.equal(parsePrice('12.00'), 1200);
    assert.equal(parsePrice('£1.10'), 110);
    assert.equal(parsePrice(' 4.75 '), 475);
  });

  it('turns down anything that is not pounds with two decimals', () => {
    for (const text of ['3.2', '3', '3.200', '-1.00', '£', '', 'abc', '1,000.00', '£ 1.00', '1.0O']) {
      assert.throws(() => parsePrice(text), TillError, `"${text}"`);
    }
  });

  it('says what it was reading', () => {
    assert.throws(() => parsePrice('3.2', 'price for sku 1001'), { message: 'not a price for sku 1001: 3.2' });
  });
});

describe('formatMoney', () => {
  it('prints pence as pounds with two decimals', () => {
    assert.equal(formatMoney(320), '£3.20');
    assert.equal(formatMoney(5), '£0.05');
    assert.equal(formatMoney(0), '£0.00');
    assert.equal(formatMoney(100000), '£1000.00');
  });

  it('puts the minus sign before the pound sign', () => {
    assert.equal(formatMoney(-85), '-£0.85');
    assert.equal(formatMoney(-1300), '-£13.00');
  });
});

describe('sum', () => {
  it('adds up a list, and an empty list is 0', () => {
    assert.equal(sum([1, 2, 3]), 6);
    assert.equal(sum([]), 0);
  });
});

describe('vatIn', () => {
  it('finds the VAT inside a VAT-inclusive amount', () => {
    assert.equal(vatIn(120, 20), 20);
    assert.equal(vatIn(1050, 5), 50);
    assert.equal(vatIn(2113, 0), 0);
  });

  it('rounds to the nearest penny', () => {
    assert.equal(vatIn(851, 20), 142); // 141.83
    assert.equal(vatIn(850, 20), 142); // 141.67
    assert.equal(vatIn(847, 20), 141); // 141.17
    assert.equal(vatIn(299, 5), 14); // 14.24
  });

  it('rounds halves up', () => {
    assert.equal(vatIn(3, 20), 1); // 0.5
    assert.equal(vatIn(9, 20), 2); // 1.5
  });

  it('has no VAT in nothing', () => {
    assert.equal(vatIn(0, 20), 0);
  });
});

describe('allocate', () => {
  it('shares a total out in proportion to the weights', () => {
    assert.deepEqual(allocate(100, [1, 1]), [50, 50]);
    assert.deepEqual(allocate(90, [1, 2]), [30, 60]);
  });

  it('gives the pennies left over to the biggest remainders', () => {
    // 4014 × 2/4 = 2007, 4014 × 1/4 = 1003.5 twice: one penny left, Ben and Chen tie, Ben is first
    assert.deepEqual(allocate(4014, [2, 1, 1]), [2007, 1004, 1003]);
    // 130 × 95/515 = 23.98 and 130 × 420/515 = 106.02: the penny goes to the .98
    assert.deepEqual(allocate(130, [95, 420]), [24, 106]);
  });

  it('breaks a tie in favour of the one listed first', () => {
    assert.deepEqual(allocate(2, [1, 1, 1]), [1, 1, 0]);
    assert.deepEqual(allocate(1, [5, 5]), [1, 0]);
  });

  it('always adds up to the total', () => {
    for (const total of [0, 1, 7, 99, 1000, 4014, 123457]) {
      for (const weights of [[1], [1, 1, 1], [3, 2, 2], [95, 420], [0, 5, 1], [7, 11, 13, 17]]) {
        assert.equal(sum(allocate(total, weights)), total, `${total} over ${weights}`);
      }
    }
  });

  it('gives nothing to a weight of 0', () => {
    assert.deepEqual(allocate(100, [0, 1]), [0, 100]);
  });

  it('needs at least one weight above 0, and none below', () => {
    assert.throws(() => allocate(100, [0, 0]));
    assert.throws(() => allocate(100, []));
    assert.throws(() => allocate(100, [2, -1]));
  });
});

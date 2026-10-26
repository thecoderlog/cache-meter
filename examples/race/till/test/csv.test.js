import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, readRecords } from '../src/csv.js';
import { TillError } from '../src/errors.js';

const cells = text => parseCsv(text).map(record => record.cells);

describe('parseCsv', () => {
  it('splits lines into records and records into fields', () => {
    assert.deepEqual(cells('a,b,c\n1,2,3\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('reads the last line without a line end', () => {
    assert.deepEqual(cells('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  });

  it('keeps empty fields', () => {
    assert.deepEqual(cells('a,,c\n,,\n'), [['a', '', 'c'], ['', '', '']]);
  });

  it('reads a quoted field with a comma in it', () => {
    assert.deepEqual(cells('8006,"Ham, cheese & pickle sandwich",3.30\n'), [['8006', 'Ham, cheese & pickle sandwich', '3.30']]);
  });

  it('reads a doubled quote inside a quoted field as one quote', () => {
    assert.deepEqual(cells('"The ""big"" one",1\n'), [['The "big" one', '1']]);
  });

  it('keeps a line end inside a quoted field', () => {
    assert.deepEqual(cells('"two\nlines",x\n'), [['two\nlines', 'x']]);
  });

  it('takes CRLF line ends', () => {
    assert.deepEqual(cells('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  });

  it('skips blank lines', () => {
    assert.deepEqual(cells('a,b\n\n1,2\n\n\n'), [['a', 'b'], ['1', '2']]);
  });

  it('keeps a line that is one empty quoted field', () => {
    assert.deepEqual(cells('a\n""\n'), [['a'], ['']]);
  });

  it('remembers the line each record started on', () => {
    const lines = parseCsv('a,b\n\n1,"x\ny"\n3,4\n').map(record => record.line);
    assert.deepEqual(lines, [1, 3, 5]);
  });

  it('turns down a quote in the middle of a field', () => {
    assert.throws(() => parseCsv('a,b\n1,2"3\n', 'cart.csv'), {
      name: 'TillError',
      message: 'cart.csv line 2: a quote in the middle of a field',
    });
  });

  it('turns down a quoted field that never ends', () => {
    assert.throws(() => parseCsv('a,b\n1,"2\n3,4\n', 'cart.csv'), {
      name: 'TillError',
      message: 'cart.csv line 2: a quoted field never ends',
    });
  });

  it('reads nothing from an empty file', () => {
    assert.deepEqual(parseCsv(''), []);
  });
});

describe('readRecords', () => {
  it('keys each record by the header, trimmed', () => {
    const records = readRecords('sku, qty\n 1001 , 2 \n', ['sku', 'qty']);
    assert.deepEqual(records, [{ line: 2, record: { sku: '1001', qty: '2' } }]);
  });

  it('takes the columns in any order and keeps extra ones', () => {
    const records = readRecords('note,qty,sku\nfor Ben,1,1001\n', ['sku', 'qty']);
    assert.deepEqual(records[0].record, { note: 'for Ben', qty: '1', sku: '1001' });
  });

  it('needs every column it was asked for', () => {
    assert.throws(() => readRecords('sku\n1001\n', ['sku', 'qty'], 'cart.csv'), {
      name: 'TillError',
      message: 'cart.csv: the header has no qty column',
    });
  });

  it('needs as many fields on each line as in the header', () => {
    assert.throws(() => readRecords('sku,qty\n1001\n', ['sku', 'qty'], 'cart.csv'), {
      name: 'TillError',
      message: 'cart.csv line 2: expected 2 fields, found 1',
    });
  });

  it('turns down an empty file', () => {
    assert.throws(() => readRecords('', ['sku'], 'cart.csv'), TillError);
  });
});

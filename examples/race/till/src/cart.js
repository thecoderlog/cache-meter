// A cart file is what's on the belt: sku,qty rows (docs/data.md › Cart). Every SKU must be in the
// catalog. The same SKU on two rows is one line on the receipt, in the place it first appeared.
import { readRecords } from './csv.js';
import { readText } from './files.js';
import { TillError } from './errors.js';

const COLUMNS = ['sku', 'qty'];

// → [{ sku, name, price, vat, category, qty, amount }], amount = price × qty in pence
export function parseCart(text, catalog, file = 'cart') {
  const bySku = new Map();
  for (const { line, record } of readRecords(text, COLUMNS, file)) {
    const where = `${file} line ${line}`;
    const product = catalog.get(record.sku);
    if (!product) throw new TillError(`${where}: no product with sku ${record.sku}`);
    if (!/^[1-9]\d*$/.test(record.qty)) throw new TillError(`${where}: qty must be a whole number of 1 or more, not "${record.qty}"`);
    const qty = Number(record.qty);
    const existing = bySku.get(product.sku);
    if (existing) existing.qty += qty;
    else bySku.set(product.sku, { ...product, qty });
  }
  if (bySku.size === 0) throw new TillError(`${file} has no items`);
  return [...bySku.values()].map(item => ({ ...item, amount: item.price * item.qty }));
}

export function loadCart(path, catalog) {
  return parseCart(readText(path), catalog, path);
}

// The shop's catalog (data/catalog.csv): every product the till can sell, by SKU (docs/data.md › Catalog).
import { readRecords } from './csv.js';
import { readText } from './files.js';
import { parsePrice } from './money.js';
import { TillError } from './errors.js';
import { BANDS } from './vat.js';

const COLUMNS = ['sku', 'name', 'price', 'vat', 'category'];

export function parseCatalog(text, file = 'catalog') {
  const catalog = new Map();
  for (const { line, record } of readRecords(text, COLUMNS, file)) {
    const { sku, name, price, vat, category } = record;
    const where = `${file} line ${line}`;
    if (!sku) throw new TillError(`${where}: empty sku`);
    if (catalog.has(sku)) throw new TillError(`${where}: sku ${sku} appears twice`);
    if (!name) throw new TillError(`${where}: sku ${sku} has no name`);
    if (!Object.hasOwn(BANDS, vat)) throw new TillError(`${where}: unknown VAT band "${vat}" (use S, R or Z)`);
    if (!/^[a-z][a-z-]*$/.test(category.toLowerCase())) throw new TillError(`${where}: bad category "${category}"`);
    catalog.set(sku, {
      sku,
      name,
      price: parsePrice(price, `price for sku ${sku}`),
      vat,
      category: category.toLowerCase(),
    });
  }
  return catalog;
}

export function loadCatalog(path) {
  return parseCatalog(readText(path), path);
}

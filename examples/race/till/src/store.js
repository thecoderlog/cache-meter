// The shop's details for the top and bottom of the receipt (data/store.json, docs/data.md › Store).
import { readJson } from './files.js';
import { TillError } from './errors.js';
import { WIDTH } from './receipt.js';

export function parseStore(raw, file = 'store') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TillError(`${file} must be a JSON object`);
  const text = (value, what) => {
    if (typeof value !== 'string' || !value.trim()) throw new TillError(`${file}: ${what} must be some text`);
    if (value.length > WIDTH) throw new TillError(`${file}: ${what} is longer than ${WIDTH} characters`);
    return value;
  };
  const address = raw.address ?? [];
  if (!Array.isArray(address)) throw new TillError(`${file}: address must be a list of lines`);
  return {
    name: text(raw.name, 'name'),
    address: address.map((value, i) => text(value, `address line ${i + 1}`)),
    vatNumber: text(raw.vatNumber, 'vatNumber'),
    footer: raw.footer === undefined ? '' : text(raw.footer, 'footer'),
  };
}

export function loadStore(path) {
  return parseStore(readJson(path), path);
}

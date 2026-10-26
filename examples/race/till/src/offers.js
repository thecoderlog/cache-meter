// This week's offers (data/offers.json), applied the way docs/offers.md describes:
// - offers are tried in the order they appear in the file;
// - each unit on the belt counts towards one offer at most;
// - inside an offer, the most expensive units are used first, so the customer always gets the bigger saving.
import { readJson } from './files.js';
import { parsePrice, sum } from './money.js';
import { TillError } from './errors.js';

const TYPES = {
  multibuy: { fields: ['skus', 'buy', 'pay'], apply: multibuy },
  fixed: { fields: ['skus', 'count', 'price'], apply: fixedPrice },
  mealdeal: { fields: ['groups', 'price'], apply: mealDeal },
};

export function parseOffers(list, catalog, file = 'offers') {
  if (!Array.isArray(list)) throw new TillError(`${file} must be a JSON array of offers`);
  const seen = new Set();
  return list.map((raw, index) => {
    const where = `${file} offer ${index + 1}`;
    if (!raw || typeof raw !== 'object') throw new TillError(`${where} is not an object`);
    const { id, type, label } = raw;
    if (typeof id !== 'string' || !id) throw new TillError(`${where} has no id`);
    if (seen.has(id)) throw new TillError(`${where}: id ${id} appears twice`);
    seen.add(id);
    if (typeof label !== 'string' || !label) throw new TillError(`${where} (${id}) has no label`);
    const kind = TYPES[type];
    if (!kind) throw new TillError(`${where} (${id}): unknown type "${type}"`);
    for (const field of kind.fields) {
      if (raw[field] === undefined) throw new TillError(`${where} (${id}) has no ${field}`);
    }
    const offer = { id, type, label };
    const known = sku => {
      if (!catalog.has(sku)) throw new TillError(`${where} (${id}): no product with sku ${sku}`);
      return sku;
    };
    const whole = (name, min) => {
      if (!Number.isInteger(raw[name]) || raw[name] < min) throw new TillError(`${where} (${id}): ${name} must be a whole number of ${min} or more`);
      return raw[name];
    };
    if (raw.skus) {
      if (!Array.isArray(raw.skus) || raw.skus.length === 0) throw new TillError(`${where} (${id}): skus must be a list`);
      offer.skus = raw.skus.map(known);
    }
    if (raw.price !== undefined) offer.price = parsePrice(raw.price, `price in ${where} (${id})`);
    if (type === 'multibuy') {
      offer.buy = whole('buy', 2);
      offer.pay = whole('pay', 1);
      if (offer.pay >= offer.buy) throw new TillError(`${where} (${id}): pay must be less than buy`);
    }
    if (type === 'fixed') offer.count = whole('count', 2);
    if (type === 'mealdeal') {
      if (!Array.isArray(raw.groups) || raw.groups.length < 2) throw new TillError(`${where} (${id}): groups must be a list of 2 or more lists`);
      offer.groups = raw.groups.map(group => {
        if (!Array.isArray(group) || group.length === 0) throw new TillError(`${where} (${id}): every group must be a list of skus`);
        return group.map(known);
      });
      const all = offer.groups.flat();
      if (new Set(all).size !== all.length) throw new TillError(`${where} (${id}): a sku is in two groups`);
    }
    return offer;
  });
}

export function loadOffers(path, catalog) {
  return parseOffers(readJson(path), catalog, path);
}

// → [{ id, label, saving, units: [{ sku, price, vat }] }]: one entry per offer that saved money, in
// file order. `saving` is in pence and positive.
export function applyOffers(lines, offers) {
  const bySku = new Map(lines.map(line => [line.sku, line]));
  const left = new Map(lines.map(line => [line.sku, line.qty]));

  // every unit of these skus that no offer has used yet, most expensive first (on a tie, the sku
  // listed first in the offer goes first)
  const free = skus => {
    const units = [];
    skus.forEach((sku, order) => {
      const line = bySku.get(sku);
      for (let n = 0; n < (left.get(sku) || 0); n++) units.push({ sku, price: line.price, vat: line.vat, order });
    });
    return units.sort((a, b) => b.price - a.price || a.order - b.order);
  };
  const use = units => {
    for (const unit of units) left.set(unit.sku, left.get(unit.sku) - 1);
  };

  const applied = [];
  for (const offer of offers) {
    const { saving, units } = TYPES[offer.type].apply(offer, free, use);
    if (saving > 0) {
      applied.push({ id: offer.id, label: offer.label, saving, units: units.map(({ sku, price, vat }) => ({ sku, price, vat })) });
    }
  }
  return applied;
}

// buy N, pay for M: in every full group of N, the N − M cheapest units are free
function multibuy(offer, free, use) {
  const units = free(offer.skus);
  const used = [];
  let saving = 0;
  for (let i = 0; i + offer.buy <= units.length; i += offer.buy) {
    const group = units.slice(i, i + offer.buy);
    saving += sum(group.slice(offer.pay).map(unit => unit.price));
    used.push(...group);
  }
  use(used);
  return { saving, units: used };
}

// N for £P: every full group of N costs P, as long as that's cheaper than the shelf prices
function fixedPrice(offer, free, use) {
  const units = free(offer.skus);
  const used = [];
  let saving = 0;
  for (let i = 0; i + offer.count <= units.length; i += offer.count) {
    const group = units.slice(i, i + offer.count);
    const shelf = sum(group.map(unit => unit.price));
    if (shelf <= offer.price) break; // later groups are cheaper still
    saving += shelf - offer.price;
    used.push(...group);
  }
  use(used);
  return { saving, units: used };
}

// one from each group for £P: take the most expensive unit left in every group, again and again,
// while every group still has one and the set costs more than P on the shelf
function mealDeal(offer, free, use) {
  const used = [];
  let saving = 0;
  for (;;) {
    const picks = offer.groups.map(group => free(group)[0]);
    if (picks.some(pick => !pick)) break;
    const shelf = sum(picks.map(unit => unit.price));
    if (shelf <= offer.price) break;
    saving += shelf - offer.price;
    use(picks);
    used.push(...picks);
  }
  return { saving, units: used };
}

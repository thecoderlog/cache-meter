// --json: the same bill as data, for the shop's other systems (docs/json.md). Money is in whole pence,
// so 320 means £3.20.
export function billJson(bill, store, split = null) {
  const out = {
    store: store.name,
    lines: bill.lines.map(({ sku, name, qty, price, amount, vat }) => ({ sku, name, qty, price, amount, vat })),
    subtotal: bill.subtotal,
    offers: bill.offers.map(({ id, label, saving }) => ({ id, label, saving })),
    savings: bill.savings,
    total: bill.total,
    vat: bill.vat.map(({ band, rate, gross, vat }) => ({ band, rate, gross, vat })),
    vatTotal: bill.vatTotal,
  };
  if (split) out.split = split.map(({ name, shares, owes }) => ({ name, shares, owes }));
  return out;
}

export function renderJson(bill, store, split = null) {
  return JSON.stringify(billJson(bill, store, split), null, 2) + '\n';
}

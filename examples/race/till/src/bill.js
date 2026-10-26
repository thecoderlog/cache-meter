// The sums behind a receipt (docs/receipt.md › Totals): what's on the belt, what the offers take off,
// what's left to pay, and the VAT inside it. Everything is in whole pence.
import { applyOffers } from './offers.js';
import { sum } from './money.js';
import { vatSummary } from './vat.js';

// → { lines, offers, subtotal, savings, total, vat, vatTotal }
// lines: the cart lines as given; offers: the offers that saved money (offers.js › applyOffers);
// vat: one row per band (vat.js › vatSummary).
export function makeBill(lines, offers = []) {
  const applied = applyOffers(lines, offers);
  const subtotal = sum(lines.map(line => line.amount));
  const savings = sum(applied.map(offer => offer.saving));
  const vat = vatSummary(lines, applied);
  return {
    lines,
    offers: applied,
    subtotal,
    savings,
    total: subtotal - savings,
    vat,
    vatTotal: sum(vat.map(row => row.vat)),
  };
}

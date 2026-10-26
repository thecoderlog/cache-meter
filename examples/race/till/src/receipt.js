// The printed receipt (docs/receipt.md). The shop's printer takes 32 characters a line, so every line
// is 32 characters or fewer, and nothing on a receipt ever ends in a space.
import { formatMoney } from './money.js';

export const WIDTH = 32;
export const RULE = '-'.repeat(WIDTH);

// A label on the left and a value on the right, WIDTH characters in all. A label too long for the line
// is cut short; the value never is.
export function line(label, value) {
  const room = WIDTH - value.length - 1;
  const text = label.length > room ? label.slice(0, room).trimEnd() : label;
  return text + ' '.repeat(WIDTH - text.length - value.length) + value;
}

export function moneyLine(label, pence) {
  return line(label, formatMoney(pence));
}

// Centred, with the odd space on the right (and nothing printed after the text)
export function center(text) {
  return ' '.repeat(Math.max(0, Math.floor((WIDTH - text.length) / 2))) + text;
}

// The blocks of a receipt, top to bottom (docs/receipt.md › Layout). `split` is splitTotal()'s
// result, or null when there's no --split.
export function renderReceipt(bill, store, split = null) {
  const out = [
    center(store.name),
    ...store.address.map(center),
    center(`VAT No. ${store.vatNumber}`),
    RULE,
  ];
  for (const item of bill.lines) {
    out.push(moneyLine(item.name, item.amount));
    if (item.qty > 1) out.push(`  ${item.qty} x ${formatMoney(item.price)}`);
  }
  out.push(RULE, moneyLine('SUBTOTAL', bill.subtotal));
  for (const offer of bill.offers) out.push(moneyLine(offer.label, -offer.saving));
  out.push(moneyLine('TOTAL', bill.total));
  out.push(RULE);
  for (const row of bill.vat) out.push(moneyLine(`VAT ${row.rate}% on ${formatMoney(row.gross)}`, row.vat));
  out.push(moneyLine('VAT TOTAL', bill.vatTotal));
  if (split) {
    out.push(RULE, 'SPLIT');
    for (const person of split) out.push(moneyLine(person.name, person.owes));
  }
  if (store.footer) out.push(RULE, center(store.footer));
  return out.join('\n') + '\n';
}

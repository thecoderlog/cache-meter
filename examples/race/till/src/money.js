// Money is kept as whole pence: £3.20 is 320. Totals never touch floats (docs/architecture.md › Money).
import { TillError } from './errors.js';

// "3.20" or "£3.20" → 320. Prices always have two decimals; anything else is a mistake.
export function parsePrice(text, what = 'price') {
  const match = /^£?(\d+)\.(\d{2})$/.exec(String(text).trim());
  if (!match) throw new TillError(`not a ${what}: ${text}`);
  return Number(match[1]) * 100 + Number(match[2]);
}

// 320 → "£3.20", -85 → "-£0.85"
export function formatMoney(pence) {
  const sign = pence < 0 ? '-' : '';
  const abs = Math.abs(pence);
  return `${sign}£${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

// The VAT inside a VAT-inclusive amount, to the nearest penny, halves rounded up:
// gross × rate / (100 + rate), in whole numbers so no float can round it the wrong way.
export function vatIn(gross, ratePercent) {
  const top = gross * ratePercent;
  const bottom = 100 + ratePercent;
  return Math.floor((2 * top + bottom) / (2 * bottom));
}

// Share `total` pence out in proportion to `weights`, in whole pence that add up to `total` exactly.
// Everyone is rounded down first; the pennies left over go one each to the biggest remainders, and on
// a tie the one earlier in the list wins (the "largest remainder" rule; docs/split.md and docs/vat.md
// both use it).
export function allocate(total, weights) {
  const all = sum(weights);
  if (!(all > 0) || weights.some(w => w < 0)) throw new Error('allocate needs weights of 0 or more, not all 0');
  const shares = weights.map(w => Math.floor((total * w) / all));
  let left = total - sum(shares);
  const order = weights
    .map((w, i) => ({ i, rest: (total * w) % all }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    shares[i] += 1;
    left -= 1;
  }
  return shares;
}

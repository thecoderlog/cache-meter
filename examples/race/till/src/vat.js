// VAT bands and the VAT block of a receipt (docs/vat.md). Shelf prices already include VAT.
import { allocate, sum, vatIn } from './money.js';

// band → rate in percent
export const BANDS = { S: 20, R: 5, Z: 0 };
// the order bands appear in on a receipt and in JSON
export const BAND_ORDER = ['S', 'R', 'Z'];

// How much of one offer's saving comes off each band: shared in proportion to the shelf prices of the
// units the offer used, in whole pence (largest remainder, ties to the band earlier in BAND_ORDER).
export function savingByBand(offer) {
  const bands = BAND_ORDER.filter(band => offer.units.some(unit => unit.vat === band));
  const weights = bands.map(band => sum(offer.units.filter(unit => unit.vat === band).map(unit => unit.price)));
  const shares = allocate(offer.saving, weights);
  return Object.fromEntries(bands.map((band, i) => [band, shares[i]]));
}

// One row per band that has something in it: what was paid in that band after offers (gross) and the
// VAT inside it. VAT is worked out once per band, never line by line.
export function vatSummary(lines, applied) {
  const gross = Object.fromEntries(BAND_ORDER.map(band => [band, 0]));
  for (const line of lines) gross[line.vat] += line.amount;
  for (const offer of applied) {
    for (const [band, share] of Object.entries(savingByBand(offer))) gross[band] -= share;
  }
  return BAND_ORDER.filter(band => gross[band] > 0).map(band => ({
    band,
    rate: BANDS[band],
    gross: gross[band],
    vat: vatIn(gross[band], BANDS[band]),
  }));
}

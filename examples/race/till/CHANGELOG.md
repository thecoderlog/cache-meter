# Changelog

## 0.10.0 (not released)

- Planned: Till Club loyalty points, `--card` (docs/loyalty.md).

## 0.9.0

- Meal deal offers: one item from each group for a fixed price (`mealdeal` in docs/offers.md).
- The CSV reader handles quoted fields, so a product name can have a comma in it
  (`"Ham, cheese & pickle sandwich"`).
- `data/cards.json` added for 0.10.0. Nothing reads it yet.

## 0.8.0

- The receipt header comes from `data/store.json`: name, address lines, VAT number and footer.
- `--catalog`, `--offers` and `--store` read other files than the ones in `data/`.
- `--no-offers` prints the receipt at shelf prices.
- Flags can be written `--flag value` or `--flag=value`. A flag given twice is now an error.

## 0.7.0

- `--json` prints the bill as JSON for the shop's other systems (docs/json.md).
- `main()` returns the exit code instead of calling `process.exit`, so the tests run the CLI
  in-process.

## 0.6.0

- VAT bands: standard (S, 20%), reduced (R, 5%) and zero (Z, 0%), from the catalog's `vat` column.
- The VAT block shows one line per band and a VAT TOTAL. VAT is worked out once per band, never per
  line (docs/vat.md).
- An offer's saving is shared across the bands of the items it used, so the VAT is on what was
  really paid.

## 0.5.0

- Offers from `data/offers.json`: `multibuy` (buy 3 pay for 2) and `fixed` (2 for £3).
- SUBTOTAL, one line per offer, then TOTAL.

## 0.4.0

- Products come from `data/catalog.csv`. Cart files are `sku,qty` now; the old
  `sku,name,price,qty` carts don't work any more.
- The same SKU on two cart rows is one receipt line.
- Lines for more than one of something show the unit price under the name: `  2 x £0.85`.

## 0.3.0

- `--split` splits the TOTAL between friends by shares (docs/split.md).

## 0.2.0

- The VAT inside the TOTAL, at 20%.
- Mistakes print one `error:` line and exit with code 2.

## 0.1.0

- First version: a receipt for CORNER SHOP from a `sku,name,price,qty` cart file.

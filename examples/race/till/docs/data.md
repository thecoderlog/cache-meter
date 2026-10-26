# The data files

The till reads four files on every run. The defaults live in `data/`; `--catalog`, `--offers` and
`--store` read others instead. A file that's missing, unreadable or broken is a mistake (exit code 2)
and the message names the file and, for CSV files, the line.

## CSV

`catalog.csv` and cart files are CSV (`src/csv.js`):

- The first row is the header. Columns can be in any order, and extra columns are allowed and ignored.
- Fields are separated by commas. A field that has a comma or a double quote in it is wrapped in
  double quotes, and a double quote inside it is written twice: `"Ham, cheese & pickle sandwich"`.
- Spaces around a field are trimmed.
- Lines can end in LF or CRLF. Blank lines are skipped.
- Every row must have as many fields as the header.

## Catalog

`data/catalog.csv` lists every product the shop sells:

| Column | What it is |
| --- | --- |
| `sku` | The product's code, as printed on the shelf label. Unique. |
| `name` | What the receipt calls it. Long names are cut short on the receipt. |
| `price` | The shelf price in pounds with two decimals, VAT included: `3.20` |
| `vat` | The VAT band: `S` (standard, 20%), `R` (reduced, 5%) or `Z` (zero, 0%). See docs/vat.md. |
| `category` | A lowercase word (dashes allowed): `bakery`, `drinks`, `giftcard`, `bag`… |

Categories matter in two places: gift cards (`giftcard`) and bags (`bag`) never earn Till Club points
(docs/loyalty.md), and the shop's reports group sales by category.

## Cart

A cart file is what's on the belt: a `sku,qty` header, then one row per product.

```
sku,qty
1001,1
1004,2
```

- Every SKU must be in the catalog.
- `qty` is a whole number of 1 or more.
- The same SKU on two rows is one line on the receipt, with the quantities added up, in the place
  where it first appeared.
- A cart with no rows is a mistake.

`data/cart.csv` is a sample cart. `test/cli.test.js` checks its whole receipt.

## Offers

`data/offers.json` is this week's offers: a JSON list, applied in the order given. See docs/offers.md
for the types and how they're applied.

## Store

`data/store.json` is the shop's details for the top and bottom of the receipt:

```json
{
  "name": "TILL & CO MARKET",
  "address": ["14 Corn Exchange", "Leeds LS1 7BR"],
  "vatNumber": "GB 284 1937 06",
  "footer": "Thank you for shopping with us"
}
```

Every value is text of 32 characters or fewer, so it fits on one receipt line. `address` can have any
number of lines (or none), and `footer` can be left out.

## Cards

`data/cards.json` holds Till Club balances, keyed by the card's 12 digits. Nothing reads it yet: it's
for the loyalty points planned for 0.10.0 (docs/loyalty.md).

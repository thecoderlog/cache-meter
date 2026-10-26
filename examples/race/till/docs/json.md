# JSON

`--json` prints the bill as JSON instead of a receipt, for the shop's other systems (the stock
system and the end-of-day report). Everything that's on the receipt is in it, and more: SKUs, VAT
bands and shares.

```
till data/cart.csv --json
```

## Format

Money is in whole pence, as numbers: `320` means £3.20. The output is indented by two spaces and
ends with a newline.

```json
{
  "store": "TILL & CO MARKET",
  "lines": [
    { "sku": "1001", "name": "Sourdough loaf", "qty": 1, "price": 320, "amount": 320, "vat": "Z" }
  ],
  "subtotal": 4419,
  "offers": [
    { "id": "pastries-3for2", "label": "Pastries 3 for 2", "saving": 85 }
  ],
  "savings": 405,
  "total": 4014,
  "vat": [
    { "band": "S", "rate": 20, "gross": 851, "vat": 142 }
  ],
  "vatTotal": 192
}
```

(Shortened: the real output has every line, offer and band, and prints each object over several
lines.)

| Field | What it is |
| --- | --- |
| `store` | The store's name |
| `lines` | One per receipt line: SKU, name, quantity, unit price, line amount, VAT band |
| `subtotal` | All the lines at shelf prices |
| `offers` | The offers that saved money, in file order, with their savings |
| `savings` | All the savings added up |
| `total` | What the customer pays |
| `vat` | One row per band that has something in it: rate, gross after offers, VAT |
| `vatTotal` | The VAT rows added up |
| `split` | Only with `--split`: `{ "name", "shares", "owes" }` per person, in the order given |

A field that's only there with a flag is left out without it, not set to `null`. A mistake prints
no JSON at all: one `error:` line on stderr and exit code 2, as always.

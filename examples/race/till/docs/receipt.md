# The receipt

The shop's printer takes 32 characters a line, in a fixed-width font. `src/receipt.js` builds every
receipt from the same blocks, top to bottom.

## Layout

```
        TILL & CO MARKET              header: the store's name, address lines and VAT
        14 Corn Exchange              number, each centred
         Leeds LS1 7BR
     VAT No. GB 284 1937 06
--------------------------------
Sourdough loaf             £3.20      items: one line per cart line, in cart order…
Butter croissant           £1.70
  2 x £0.85                           …with the unit price under it when there's more than one
...
--------------------------------
SUBTOTAL                  £44.19      totals: SUBTOTAL, one line per offer that saved
Pastries 3 for 2          -£0.85      money, then TOTAL
...
TOTAL                     £40.14
--------------------------------
VAT 20% on £8.51           £1.42      VAT: one line per band, then VAT TOTAL (docs/vat.md)
...
VAT TOTAL                  £1.92
--------------------------------
SPLIT                                 optional blocks, only when their flag is given
Asha                      £20.07      (--split: docs/split.md)
...
--------------------------------
 Thank you for shopping with us       footer: the store's footer, centred (left out when empty)
```

(`...` marks lines left out here. `test/cli.test.js` has the whole receipt for `data/cart.csv`.)

Every block after the items starts with a rule: 32 dashes. The optional blocks come after the VAT
block and before the footer.

## Lines

- A line has a label on the left and a value on the right, with spaces between, 32 characters in
  all: `line(label, value)` in receipt.js. Money values go through `moneyLine(label, pence)`.
- When the label is too long for the line, it's cut short so there's still one space before the
  value. The value is never cut: `Ham, cheese & pickle sandw £3.30`.
- Headers and the footer are centred with `center(text)`: the spaces go on the left, and the odd one
  out goes on the right (where nothing is printed).
- No line ends in a space, and no line is longer than 32 characters.

## Totals

- An item line shows what that line costs at shelf prices: unit price × quantity.
- SUBTOTAL is all the item lines added up.
- Each offer that saved money gets a line with its label and the saving, as a negative amount. The
  offers are listed in the order they're in `data/offers.json`. An offer that saved nothing isn't
  printed.
- TOTAL is SUBTOTAL minus the savings. It's what the customer pays.

## Money

Amounts are printed with a pound sign, two decimals and no commas: `£3.20`, `£0.05`, `£1000.00`.
Savings are negative: `-£0.85`.

# Till Club loyalty points

Status: planned for 0.10.0, not built yet.

Till Club is the shop's loyalty card. The customer hands over their card at the till, the person at the
counter types its number in, and the receipt shows the points the shop earned them and their new
balance.

    till data/cart.csv --card "6301 2345 6786"

## The card number

- A Till Club card number is 12 digits, printed in three groups of four: `6301 2345 6786`.
- Spaces and dashes in it are ignored, so `630123456786`, `6301 2345 6786` and `6301-2345-6786` are
  the same card.
- The last digit is a check digit (the Luhn check, the same one bank cards use). Starting from the
  right, double every second digit: the second-to-last, the fourth-to-last, and so on. When doubling
  gives more than 9, take 9 off. Add up all twelve digits after the doubling; the total must end in 0.
  `6301 2345 6786` passes. `6301 2345 6787` doesn't.
- A number that isn't 12 digits once the spaces and dashes are gone, has anything else in it, or fails
  the check is a mistake like any other (docs/architecture.md › Errors): one line starting with
  `error:` on stderr, no receipt, exit code 2.

## Points

- 1 point for every whole pound of the TOTAL, after offers.
- Gift cards and bags (the `giftcard` and `bag` categories in the catalog) don't earn points, so take
  their amounts off the TOTAL first.
- Round down once, at the very end. A TOTAL of £40.14 with two carrier bags (£0.20) on it is £39.94
  that earns points, so 39 points.

## Balance

- `data/cards.json` has every card's balance before today's shop, keyed by the 12 digits:

      { "630123456786": 1215 }

- A card that passes the check but isn't in the file is a new card: its balance starts at 0.
- The new balance is the old one plus the points earned. The till only prints it: it never writes
  `data/cards.json` (the office updates the file every night).

## On the receipt

After the VAT block, and before the SPLIT block when there is one: a rule, then three lines.

    VAT TOTAL                  £1.92
    --------------------------------
    TILL CLUB         **** **** 6786
    POINTS EARNED                 39
    POINTS BALANCE             1,254
    --------------------------------
     Thank you for shopping with us

- The card is shown as `**** **** ` and its last four digits.
- Both numbers have a comma for every three digits, so 1254 prints as `1,254` and 1234567 as
  `1,234,567`.
- These are receipt lines like any other: the label on the left, the value on the right, 32
  characters wide (docs/receipt.md › Lines).
- Without `--card`, the receipt is exactly what it was before.

## JSON

With `--json` and `--card`, the JSON has a `loyalty` field (docs/json.md):

    "loyalty": { "card": "6786", "pointsEarned": 39, "balance": 1254 }

`card` is the last four digits only. Without `--card` there is no `loyalty` field.

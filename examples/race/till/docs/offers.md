# Offers

This week's offers are in `data/offers.json`, a JSON list. Each offer has an `id` (unique), a `type`,
and a `label` that's printed on the receipt. `src/offers.js` checks the file when it's read: an offer
with a missing field, an unknown type or a SKU that isn't in the catalog is a mistake that names the
offer.

## Types

### multibuy: buy N, pay for M

```json
{ "id": "pastries-3for2", "type": "multibuy", "label": "Pastries 3 for 2",
  "skus": ["1004", "1005", "1006"], "buy": 3, "pay": 2 }
```

Any mix of the listed SKUs counts. Every full group of `buy` units costs the price of its `pay` most
expensive units: the rest are free. A group that isn't full gets nothing.

### fixed: N for £P

```json
{ "id": "crisps-2for3", "type": "fixed", "label": "Crisps 2 for £3",
  "skus": ["7001", "7002"], "count": 2, "price": "3.00" }
```

Every full group of `count` units costs `price` instead of its shelf prices, as long as that's
cheaper. A group whose shelf prices already add up to `price` or less is left alone.

### mealdeal: one from each group for £P

```json
{ "id": "meal-deal", "type": "mealdeal", "label": "Meal deal", "price": "3.85",
  "groups": [["8001", "8002"], ["6004", "6007"], ["7003", "7009"]] }
```

A meal is one unit from every group: a main, a drink and a snack. Each meal costs `price`. The till
makes as many meals as it can, and a meal only counts when it's cheaper than its shelf prices. A SKU
can only be in one group.

## How offers are applied

- Offers are applied one after another, in the order they're in the file.
- A unit (one croissant, not one cart line) can only count towards one offer. Once an offer has used
  it, the offers after it can't.
- Inside an offer, the most expensive units are used first, so the customer always gets the bigger
  saving. For a multibuy that means the cheapest units in each group are the free ones; for a meal
  deal it means the most expensive main, drink and snack make the first meal. When two units cost the
  same, the SKU listed first in the offer goes first.
- Each offer that saved money is one line on the receipt, with its whole saving. The saving is in
  whole pence.

### Example

Two butter croissants (£0.85) and a pain au chocolat (£0.95) with the 3 for 2: one group of three,
sorted by price £0.95, £0.85, £0.85. The customer pays for the first two, so the saving is £0.85.

## VAT on offers

A saving comes off the price of things in different VAT bands. To keep the VAT right, each offer's
saving is shared across the bands of the units it used, in proportion to their shelf prices
(docs/vat.md › Offers and VAT).

## --no-offers

`--no-offers` leaves `data/offers.json` unread and prints the receipt at shelf prices: no offer
lines, and TOTAL is the same as SUBTOTAL.

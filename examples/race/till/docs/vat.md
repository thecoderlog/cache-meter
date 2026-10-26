# VAT

Shelf prices include VAT, so the till never adds VAT: it shows how much of what the customer paid is
VAT, the way UK receipts do.

## Bands

Each product in the catalog has a band in its `vat` column:

| Band | Rate | Examples |
| --- | --- | --- |
| `S` standard | 20% | soft drinks, crisps, chocolate, alcohol, toiletries, household |
| `R` reduced | 5% | nicotine patches and gum, logs for the fire |
| `Z` zero | 0% | most food, milkshakes, Jaffa cakes, sanitary products, gift cards |

## The VAT block

After the TOTAL, one line per band that has something in it, in the order S, R, Z, then the VAT
TOTAL:

```
VAT 20% on £8.51           £1.42
VAT 5% on £10.50           £0.50
VAT 0% on £21.13           £0.00
VAT TOTAL                  £1.92
```

- The amount after `on` is what the customer paid for that band's items, after offers (the band's
  gross).
- The VAT is worked out once per band, from the band's gross: gross × rate ÷ (100 + rate), to the
  nearest penny, halves rounded up (`money.js › vatIn`). Never line by line: rounding each line would
  make the VAT TOTAL drift by a few pence on a big shop.
- The grosses add up to the TOTAL.

## Offers and VAT

An offer's saving can come off items in different bands. A meal deal with a sandwich (Z), a can of
cola (S) and a fruit pot (Z) saves £1.30; how much of that comes off the cola decides the VAT.

The till shares each offer's saving across the bands of the units it used, in proportion to their
shelf prices, in whole pence (`vat.js › savingByBand`, using `money.js › allocate`):

- Sandwich £3.10 (Z) + fruit pot £1.10 (Z) = £4.20 in Z; cola can £0.95 in S.
- £1.30 × 95 ÷ 515 = 23.98p for S, £1.30 × 420 ÷ 515 = 106.02p for Z.
- Rounded down that's 23p + 106p = 129p; the penny left over goes to the bigger remainder, S.
- So 24p comes off S and 106p off Z.

Then each band's gross is its items at shelf prices, minus its shares of the savings.

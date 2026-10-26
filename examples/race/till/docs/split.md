# Splitting the bill

Added in 0.3.0. Friends often pay for one basket together. `--split` prints what each of them owes,
after the VAT block.

    till data/cart.csv --split Asha:2,Ben,Chen

## Who pays what

- The value is a comma-separated list of names. A name can carry a number of shares after a colon:
  `Asha:2` means Asha pays for two shares. A name on its own has one share.
- Each person owes the TOTAL times their shares, divided by all the shares, in whole pence. It's the
  TOTAL after offers that gets split, not the SUBTOTAL.
- Round everyone down to the penny first. Then hand out the pennies that are left, one each, to the
  people who lost the most in the rounding. When two people lost the same amount, the one listed first
  gets the penny. So the amounts always add up to the TOTAL exactly (money.js › allocate).
- The VAT block is not split.

## On the receipt

After the VAT block: a rule, a line that says `SPLIT`, then one line per person in the order given,
the name on the left and what they owe on the right, 32 characters wide like every other line. The
footer comes after it.

    --------------------------------
    SPLIT
    Asha                      £20.07
    Ben                       £10.04
    Chen                      £10.03
    --------------------------------
     Thank you for shopping with us

With `--json`, the same people are in a `split` field (docs/json.md).

## Mistakes

An empty name, a name that appears twice, or a share count that isn't a whole number of 1 or more is
an error: print one line starting with `error:` to stderr, print no receipt, and exit with code 2.

    till data/cart.csv --split Asha,,Ben     error: --split: an empty name in "Asha,,Ben"
    till data/cart.csv --split Asha,Asha     error: --split: Asha appears twice
    till data/cart.csv --split Asha:0,Ben    error: --split: shares for Asha must be a whole number of 1 or more, not "0"

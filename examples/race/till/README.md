# till

Prints a shop receipt from a cart file, the way the till at TILL & CO MARKET does: this week's offers
taken off, VAT shown by band, and the bill split between friends when they ask.

```
$ node src/cli.js data/cart.csv
        TILL & CO MARKET
        14 Corn Exchange
         Leeds LS1 7BR
     VAT No. GB 284 1937 06
--------------------------------
Sourdough loaf             £3.20
Butter croissant           £1.70
  2 x £0.85
...
--------------------------------
SUBTOTAL                  £44.19
Pastries 3 for 2          -£0.85
Crisps 2 for £3           -£0.60
Meal deal                 -£1.30
Cola 2l 2 for £3          -£1.30
TOTAL                     £40.14
--------------------------------
VAT 20% on £8.51           £1.42
VAT 5% on £10.50           £0.50
VAT 0% on £21.13           £0.00
VAT TOTAL                  £1.92
--------------------------------
 Thank you for shopping with us
```

No dependencies: Node 18.17 or later, nothing to install. `npm link` puts a `till` command on your path.

## Usage

```
till <cart.csv> [flags]
```

A cart file is what's on the belt: CSV with a `sku,qty` header, one row per product (docs/data.md ›
Cart). The products, their prices and VAT bands come from the catalog.

## Flags

| Flag | What it does |
| --- | --- |
| `--split Asha:2,Ben` | Splits the TOTAL between friends, by shares (docs/split.md) |
| `--json` | Prints the bill as JSON instead of a receipt (docs/json.md) |
| `--catalog <file>` | Products and prices (default `data/catalog.csv`) |
| `--offers <file>` | This week's offers (default `data/offers.json`) |
| `--store <file>` | The shop's name, address, VAT number and footer (default `data/store.json`) |
| `--no-offers` | Leaves the offers out, for a shelf-price receipt |
| `--help` | Shows the flags |
| `--version` | Shows the till's version |

A flag's value can follow it (`--split Asha,Ben`) or be joined to it with `=` (`--split=Asha,Ben`).
An unknown flag, a flag given twice or a flag with no value is a mistake: the till prints one line
starting with `error:` to stderr, prints no receipt, and exits with code 2. So does a cart line it
can't read, a product that isn't in the catalog, or a data file that's missing or broken.

## Files

```
src/cli.js        the command line: reads the flags and files, prints the receipt or JSON
src/args.js       the flags (FLAGS, HELP, parseArgs)
src/csv.js        a small CSV reader
src/catalog.js    data/catalog.csv → products by SKU
src/cart.js       a cart file → receipt lines
src/offers.js     data/offers.json, and applying the offers to the lines
src/vat.js        VAT bands and the VAT block
src/bill.js       SUBTOTAL, offers, TOTAL and VAT for one cart
src/split.js      --split
src/store.js      data/store.json
src/receipt.js    the printed receipt, 32 characters wide
src/json.js       --json
src/money.js      money in whole pence: parsing, printing, VAT, sharing out
src/files.js      reading files, with errors that name the file
src/errors.js     TillError: a mistake in what the till was given
data/             the shop's catalog, offers, store details and loyalty cards, and a sample cart
docs/             how each part works; start with docs/architecture.md
test/             node:test tests, one file per module
```

## Tests

```
npm test
```

Runs every `test/*.test.js` file with Node's built-in test runner. See CONTRIBUTING.md before you
change anything.

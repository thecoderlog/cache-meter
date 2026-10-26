// The race's hidden checks: is Till Club loyalty (docs/loyalty.md) done right? Run inside one run's copy of the
// till after the agent has finished:   node check.mjs [repo folder]
//
// The agent never sees this file or the carts in it. It prints one line per check, a JSON line, and a last
// line, "pass: 15 of 15 checks" or "fail: <the first check that failed>". Exit code 0 means pass.
//
// Everything checked is written in docs/loyalty.md. The receipts it expects are the till's own receipts from
// before the change (it runs the untouched copy next to this file), with the Till Club block put in.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(process.argv[2] ?? '.');
const PRISTINE = fileURLToPath(new URL('./till/', import.meta.url));
const WIDTH = 32;
const RULE = '-'.repeat(WIDTH);

const CARD = { number: '6301 2345 6786', last4: '6786', balance: 1215 };
const NEW_CARD = '6301 7777 7772'; // passes the check, not in data/cards.json
const MILLION = { number: '6301 5555 0001', balance: 1234567 };
const ALMOST = { number: '6301 4242 4245', balance: 961 };

class Report {
  constructor(name) {
    this.name = name;
    this.checks = [];
  }
  add(id, ok, detail = '') {
    this.checks.push({ id, ok: Boolean(ok), detail });
    console.log(`${ok ? '✓' : '✗'} ${id}${detail ? `: ${detail}` : ''}`);
    return ok;
  }
  finish() {
    const failed = this.checks.filter(c => !c.ok);
    console.log('JSON ' + JSON.stringify({ check: this.name, pass: failed.length === 0, checks: this.checks }));
    console.log(failed.length === 0
      ? `pass: ${this.checks.length} of ${this.checks.length} checks`
      : `fail: ${failed[0].id}${failed[0].detail ? ` (${failed[0].detail})` : ''}`);
    return failed.length === 0;
  }
}

function run(cwd, command, args, timeout = 30_000) {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' };
  for (const name of Object.keys(env)) if (/^(ANTHROPIC_|CACHE_METER_|W15_)/.test(name)) delete env[name];
  const p = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout });
  return { code: p.status ?? -1, out: p.stdout ?? '', err: (p.stderr ?? '') + (p.error ? String(p.error) : '') };
}

const till = (...args) => run(REPO, process.execPath, ['src/cli.js', ...args]);
const before = (...args) => run(PRISTINE, process.execPath, ['src/cli.js', ...args]);

const line = (label, value) => label + ' '.repeat(Math.max(1, WIDTH - label.length - value.length)) + value;
const count = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const first = text => (text.trim().split('\n')[0] || '').slice(0, 90);

// The receipt from before the change, with the Till Club block after VAT TOTAL
function withClub(receipt, last4, earned, balance) {
  const lines = receipt.split('\n');
  const at = lines.findIndex(l => l.startsWith('VAT TOTAL'));
  lines.splice(at + 1, 0, RULE, line('TILL CLUB', `**** **** ${last4}`), line('POINTS EARNED', count(earned)), line('POINTS BALANCE', count(balance)));
  return lines.join('\n');
}

// Where two receipts first differ, for the report
function firstDifference(got, want) {
  const a = got.split('\n');
  const b = want.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `line ${i + 1} is ${JSON.stringify(a[i] ?? '(none)')}, expected ${JSON.stringify(b[i] ?? '(none)')}`;
  }
  return '';
}

function sameReceipt(r, id, result, want) {
  if (result.code !== 0) return r.add(id, false, `exit ${result.code}: ${first(result.err)}`);
  return r.add(id, result.out === want, result.out === want ? '' : firstDifference(result.out, want));
}

function isMistake(result) {
  const errLines = result.err.trim().split('\n');
  return result.code === 2 && result.out === '' && errLines.length === 1 && errLines[0].startsWith('error:');
}

const r = new Report('loyalty');
const scratch = mkdtempSync(join(tmpdir(), 'hidden-check-'));
const outputs = [];
const keep = result => {
  outputs.push(result.out);
  return result;
};

try {
  // 1. the agent's own tests, and some new ones
  // (the counts as node --test prints them: "# tests 142", or "ℹ tests 142" with the spec reporter)
  const counted = (result, what) => Number((new RegExp(`^(?:#|ℹ)\\s*${what} (\\d+)`, 'm').exec(result.out + result.err) ?? [])[1] ?? 0);
  const baseline = counted(run(PRISTINE, 'npm', ['test'], 180_000), 'tests');
  const tests = run(REPO, 'npm', ['test'], 180_000);
  const n = counted(tests, 'tests');
  r.add('npm test passes, with new tests', tests.code === 0 && n > baseline,
    tests.code !== 0 ? `exit ${tests.code}, ${counted(tests, 'fail')} failing` : `${n} tests, ${n - baseline} new`);

  // the behaviour checks run on the shop's own data files, as they were
  cpSync(join(PRISTINE, 'data'), join(REPO, 'data'), { recursive: true });
  const cardsHash = hash(join(REPO, 'data', 'cards.json'));
  const carts = {
    gifts: 'sku,qty\n15002,1\n16002,1\n4005,1\n6004,1\n', // £25 gift card, bag for life, £5.70 of food and drink
    pastries: 'sku,qty\n1004,1\n1005,1\n1006,1\n', // £3.20, 3 for 2 takes £0.85 off
    wine: 'sku,qty\n6008,200\n', // £1500
  };
  for (const [name, text] of Object.entries(carts)) writeFileSync(join(scratch, `${name}.csv`), text);
  const cart = name => join(scratch, `${name}.csv`);

  const plain = before('data/cart.csv').out;
  const plainSplit = before('data/cart.csv', '--split', 'Asha:2,Ben,Chen').out;
  const plainJson = JSON.parse(before('data/cart.csv', '--json').out);

  // 2. nothing changes without --card
  const unchanged = [
    [keep(till('data/cart.csv')), plain],
    [keep(till('data/cart.csv', '--split', 'Asha:2,Ben,Chen')), plainSplit],
  ];
  const jsonPlain = till('data/cart.csv', '--json');
  let jsonSame = false;
  try {
    jsonSame = JSON.stringify(JSON.parse(jsonPlain.out)) === JSON.stringify(plainJson);
  } catch {}
  const broken = unchanged.findIndex(([got, want]) => got.code !== 0 || got.out !== want);
  r.add('the receipt and the JSON without --card are unchanged', broken === -1 && jsonSame,
    broken !== -1 ? firstDifference(unchanged[broken][0].out, unchanged[broken][1]) || `exit ${unchanged[broken][0].code}`
      : jsonSame ? '' : 'the JSON without --card changed');

  // 3. the block, for the sample cart and a card in data/cards.json
  const want = withClub(plain, CARD.last4, 39, CARD.balance + 39);
  sameReceipt(r, `--card "${CARD.number}": 39 points, balance 1,254`, keep(till('data/cart.csv', '--card', CARD.number)), want);

  // 4. the same card written three other ways
  const forms = ['630123456786', '6301-2345-6786', ' 6301 2345 6786 '];
  const formResults = forms.map(form => keep(till('data/cart.csv', '--card', form)));
  const badForm = formResults.findIndex(res => res.code !== 0 || res.out !== want);
  r.add('the card with no spaces, with dashes, with spaces around it', badForm === -1,
    badForm === -1 ? '' : `"${forms[badForm]}": ${formResults[badForm].code !== 0 ? first(formResults[badForm].err) : firstDifference(formResults[badForm].out, want)}`);

  // 5-7. card numbers that are mistakes
  const mistakes = (id, values) => {
    const wrong = values.find(value => !isMistake(till('data/cart.csv', '--card', value)));
    if (wrong === undefined) return r.add(id, true);
    const res = till('data/cart.csv', '--card', wrong);
    return r.add(id, false, `"${wrong}" → exit ${res.code}${res.out ? ', printed a receipt' : ''}${res.err ? `, stderr ${JSON.stringify(first(res.err))}` : ''}`);
  };
  mistakes('a wrong check digit is an error', ['6301 2345 6787', '6301 2345 6780', '6301 4242 4244']);
  mistakes('a number that isn\'t 12 digits is an error', ['6301 2345 678', '6301 2345 67860', '', '-']);
  mistakes('a number with anything else in it is an error', ['6301 2345 678A', '6301.2345.6786', '6301_2345_6786', '#630123456786']);

  // 8. points come from the TOTAL after offers
  const pastries = keep(till(cart('pastries'), '--card', CARD.number));
  sameReceipt(r, 'points on the TOTAL after offers (£2.35: 2 points, not 3)', pastries,
    withClub(before(cart('pastries')).out, CARD.last4, 2, CARD.balance + 2));

  // 9. gift cards and bags earn nothing
  sameReceipt(r, 'gift cards and bags earn no points (£31.20 with £25.50 of them: 5 points)', keep(till(cart('gifts'), '--card', CARD.number)),
    withClub(before(cart('gifts')).out, CARD.last4, 5, CARD.balance + 5));

  // 10. a new card
  sameReceipt(r, 'a card that isn\'t in data/cards.json starts at 0', keep(till('data/cart.csv', '--card', NEW_CARD)),
    withClub(plain, '7772', 39, 39));

  // 11. commas
  const commas = [
    [keep(till('data/cart.csv', '--card', MILLION.number)), withClub(plain, '0001', 39, MILLION.balance + 39)],
    [keep(till('data/cart.csv', '--card', ALMOST.number)), withClub(plain, '4245', 39, ALMOST.balance + 39)],
    [keep(till(cart('wine'), '--card', CARD.number)), withClub(before(cart('wine')).out, CARD.last4, 1500, CARD.balance + 1500)],
  ];
  const noComma = commas.findIndex(([got, expected]) => got.out !== expected);
  r.add('both numbers get commas (1,234,606 · 1,000 · 1,500 earned)', noComma === -1,
    noComma === -1 ? '' : commas[noComma][0].code !== 0 ? first(commas[noComma][0].err) : firstDifference(commas[noComma][0].out, commas[noComma][1]));

  // 12. with --split: VAT, Till Club, SPLIT, footer
  sameReceipt(r, 'with --split: the Till Club block comes before SPLIT', keep(till('data/cart.csv', '--split', 'Asha:2,Ben,Chen', '--card', CARD.number)),
    withClub(plainSplit, CARD.last4, 39, CARD.balance + 39));

  // 13. JSON
  const json = till('data/cart.csv', '--json', '--card', CARD.number);
  let bill = null;
  try {
    bill = JSON.parse(json.out);
  } catch {}
  const loyaltyOk = bill && JSON.stringify(bill.loyalty) === JSON.stringify({ card: CARD.last4, pointsEarned: 39, balance: 1254 });
  const { loyalty, ...rest } = bill ?? {};
  const restOk = bill && JSON.stringify(Object.keys(rest).sort()) === JSON.stringify(Object.keys(plainJson).sort())
    && Object.keys(plainJson).every(key => JSON.stringify(rest[key]) === JSON.stringify(plainJson[key]));
  r.add('--json --card has the loyalty field, and the rest as before', Boolean(loyaltyOk && restOk),
    !bill ? `exit ${json.code}: not JSON` : !loyaltyOk ? `loyalty is ${JSON.stringify(bill.loyalty)}` : restOk ? '' : 'other fields changed');

  // 14. the till never writes data/cards.json
  r.add('data/cards.json is never written', hash(join(REPO, 'data', 'cards.json')) === cardsHash);

  // 15. every line printed fits the printer
  const tooLong = outputs.flatMap(text => text.split('\n')).find(l => [...l].length > WIDTH || /\s$/.test(l));
  r.add('every receipt line is 32 characters or fewer, with no spaces at the end', tooLong === undefined, tooLong === undefined ? '' : JSON.stringify(tooLong));
} catch (err) {
  r.add('the checks ran', false, String(err.message || err).slice(0, 120));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exitCode = r.finish() ? 0 : 1;

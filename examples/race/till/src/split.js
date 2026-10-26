// Splitting the bill between friends (docs/split.md): --split Asha:2,Ben,Chen
import { allocate } from './money.js';
import { TillError } from './errors.js';

// "Asha:2,Ben,Chen" → [{ name: 'Asha', shares: 2 }, { name: 'Ben', shares: 1 }, { name: 'Chen', shares: 1 }]
export function parseSplit(text) {
  const people = [];
  for (const part of String(text).split(',')) {
    const colon = part.indexOf(':');
    const name = (colon === -1 ? part : part.slice(0, colon)).trim();
    if (!name) throw new TillError(`--split: an empty name in "${text}"`);
    if (people.some(person => person.name === name)) throw new TillError(`--split: ${name} appears twice`);
    let shares = 1;
    if (colon !== -1) {
      const count = part.slice(colon + 1).trim();
      if (!/^[1-9]\d*$/.test(count)) {
        throw new TillError(`--split: shares for ${name} must be a whole number of 1 or more, not "${count}"`);
      }
      shares = Number(count);
    }
    people.push({ name, shares });
  }
  return people;
}

// → [{ name, shares, owes }], in the order given. What everyone owes adds up to `total` exactly.
export function splitTotal(total, people) {
  const owes = allocate(total, people.map(person => person.shares));
  return people.map((person, i) => ({ ...person, owes: owes[i] }));
}

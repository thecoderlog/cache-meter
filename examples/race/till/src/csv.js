// A small CSV reader for the till's data files (docs/data.md › CSV): a header row, then one record
// per line. Fields are separated by commas; a field that holds a comma or a double quote is wrapped in
// double quotes, and a double quote inside it is written twice. LF or CRLF line ends; blank lines are
// skipped. Every record remembers the line it started on, for error messages.
import { TillError } from './errors.js';

export function parseCsv(text, file = 'CSV file') {
  const records = [];
  let cells = [];
  let field = '';
  let quoted = false;
  let fieldWasQuoted = false;
  let line = 1;
  let startLine = 1;

  const endField = () => {
    cells.push(field);
    field = '';
    fieldWasQuoted = false;
  };
  const endRecord = () => {
    const lastWasQuoted = fieldWasQuoted;
    endField();
    if (cells.length > 1 || cells[0] !== '' || lastWasQuoted) records.push({ line: startLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
    } else if (ch === '"') {
      if (field !== '') throw new TillError(`${file} line ${line}: a quote in the middle of a field`);
      quoted = true;
      fieldWasQuoted = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      startLine = line;
    } else {
      field += ch;
    }
  }
  if (quoted) throw new TillError(`${file} line ${startLine}: a quoted field never ends`);
  endRecord();
  return records;
}

// Records as objects keyed by the header row. `columns` are the headers the file must have (in any
// order; extra columns are allowed and kept). Values are trimmed.
export function readRecords(text, columns, file = 'CSV file') {
  const [header, ...body] = parseCsv(text, file);
  if (!header) throw new TillError(`${file} is empty`);
  const names = header.cells.map(name => name.trim());
  for (const column of columns) {
    if (!names.includes(column)) throw new TillError(`${file}: the header has no ${column} column`);
  }
  return body.map(({ line, cells }) => {
    if (cells.length !== names.length) {
      throw new TillError(`${file} line ${line}: expected ${names.length} fields, found ${cells.length}`);
    }
    const record = Object.fromEntries(names.map((name, i) => [name, cells[i].trim()]));
    return { line, record };
  });
}

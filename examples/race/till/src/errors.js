// A TillError is a mistake in what the till was given: a bad flag, a cart line it can't read, a file
// that isn't there. The CLI prints its message as one line starting with "error:" on stderr, prints
// nothing on stdout, and exits with code 2 (docs/architecture.md › Errors). Anything else that goes
// wrong is a bug in the till, and Node prints the stack trace as usual.
export class TillError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TillError';
    this.exitCode = 2;
  }
}

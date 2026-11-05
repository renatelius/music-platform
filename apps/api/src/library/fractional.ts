// Fractional indexing (docs/I7_PLAN.md §4): order keys for playlist items. A key between two
// others never requires changing them, so a move or an insert is one row and one change.
// Keys compare byte by byte (JavaScript `<`, SQL `COLLATE "C"`). The scheme follows David
// Greenspan's "fractional-indexing": a variable-length integer part keeps appends short
// ("a0", "a1" … "az", "b00"), a fraction allows inserting anywhere.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const INTEGER_ZERO = 'a0';
const SMALLEST_INTEGER = 'A00000000000000000000000000';

export class OrderKeyError extends Error {
  override name = 'OrderKeyError';
}

function digit(char: string | undefined): number {
  const value = char === undefined ? -1 : DIGITS.indexOf(char);
  if (value === -1) throw new OrderKeyError(`Invalid order key digit: ${String(char)}`);
  return value;
}

function digitAt(index: number): string {
  const char = DIGITS[index];
  if (char === undefined) throw new OrderKeyError(`No digit ${String(index)}`);
  return char;
}

/** A key strictly between fractions `a` and `b` (null = no upper bound). No trailing zeros. */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new OrderKeyError(`${a} >= ${b}`);
  if (a.endsWith('0') || (b !== null && b.endsWith('0'))) {
    throw new OrderKeyError('Trailing zero in an order key');
  }
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n += 1;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a === '' ? 0 : digit(a[0]);
  const digitB = b === null ? DIGITS.length : digit(b[0]);
  if (digitB - digitA > 1) return digitAt(Math.round(0.5 * (digitA + digitB)));
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return digitAt(digitA) + midpoint(a.slice(1), null);
}

function integerLength(head: string | undefined): number {
  if (head !== undefined && head >= 'a' && head <= 'z') return head.charCodeAt(0) - 95;
  if (head !== undefined && head >= 'A' && head <= 'Z') return 92 - head.charCodeAt(0);
  throw new OrderKeyError(`Invalid order key head: ${String(head)}`);
}

function integerPart(key: string): string {
  const length = integerLength(key[0]);
  if (length > key.length) throw new OrderKeyError(`Order key too short: ${key}`);
  return key.slice(0, length);
}

export function isValidOrderKey(key: string): boolean {
  try {
    if (key === SMALLEST_INTEGER) return false;
    const integer = integerPart(key);
    for (const char of key.slice(1)) digit(char);
    return !key.slice(integer.length).endsWith('0');
  } catch {
    return false;
  }
}

function validate(key: string): void {
  if (!isValidOrderKey(key)) throw new OrderKeyError(`Invalid order key: ${key}`);
}

function incrementInteger(x: string): string | null {
  const head = x.slice(0, 1);
  const digits = x.slice(1).split('');
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i -= 1) {
    const next = digit(digits[i]) + 1;
    if (next === DIGITS.length) {
      digits[i] = '0';
    } else {
      digits[i] = digitAt(next);
      carry = false;
    }
  }
  if (!carry) return head + digits.join('');
  if (head === 'Z') return INTEGER_ZERO;
  if (head === 'z') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') digits.push('0');
  else digits.pop();
  return nextHead + digits.join('');
}

function decrementInteger(x: string): string | null {
  const head = x.slice(0, 1);
  const digits = x.slice(1).split('');
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i -= 1) {
    const next = digit(digits[i]) - 1;
    if (next === -1) {
      digits[i] = digitAt(DIGITS.length - 1);
    } else {
      digits[i] = digitAt(next);
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join('');
  if (head === 'a') return `Z${digitAt(DIGITS.length - 1)}`;
  if (head === 'A') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (nextHead < 'Z') digits.push(digitAt(DIGITS.length - 1));
  else digits.pop();
  return nextHead + digits.join('');
}

/** A key that sorts strictly between `a` and `b`; null = open end. */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) validate(a);
  if (b !== null) validate(b);
  if (a !== null && b !== null && a >= b) throw new OrderKeyError(`${a} >= ${b}`);
  if (a === null) {
    if (b === null) return INTEGER_ZERO;
    const intB = integerPart(b);
    const fracB = b.slice(intB.length);
    if (intB === SMALLEST_INTEGER) return intB + midpoint('', fracB);
    if (intB < b) return intB;
    const lower = decrementInteger(intB);
    if (lower === null) throw new OrderKeyError('Cannot go below the smallest key');
    return lower;
  }
  const intA = integerPart(a);
  const fracA = a.slice(intA.length);
  if (b === null) {
    const higher = incrementInteger(intA);
    return higher === null ? intA + midpoint(fracA, null) : higher;
  }
  const intB = integerPart(b);
  const fracB = b.slice(intB.length);
  if (intA === intB) return intA + midpoint(fracA, fracB);
  const higher = incrementInteger(intA);
  if (higher === null) throw new OrderKeyError('Cannot go above the largest key');
  if (higher < b) return higher;
  return intA + midpoint(fracA, null);
}

/** `count` increasing keys between `a` and `b`, as short as possible (spread, not chained). */
export function keysBetween(a: string | null, b: string | null, count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return [keyBetween(a, b)];
  if (b === null) {
    // Appends: consecutive integers stay short.
    const keys: string[] = [];
    let previous = a;
    for (let i = 0; i < count; i += 1) {
      previous = keyBetween(previous, null);
      keys.push(previous);
    }
    return keys;
  }
  if (a === null) {
    const keys: string[] = [];
    let next = b;
    for (let i = 0; i < count; i += 1) {
      next = keyBetween(null, next);
      keys.push(next);
    }
    return keys.reverse();
  }
  const middle = Math.floor(count / 2);
  const mid = keyBetween(a, b);
  return [...keysBetween(a, mid, middle), mid, ...keysBetween(mid, b, count - middle - 1)];
}

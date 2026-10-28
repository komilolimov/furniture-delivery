import { describe, expect, it } from 'vitest';
import { centsInput, formatCents, parseEuroCents } from './money';

describe('exact euro input', () => {
  it.each([
    ['650,50', 65050],
    ['650.5', 65050],
    ['0', 0],
    ['0.01', 1],
    ['20000000.00', 2_000_000_000],
    ['001.20', 120],
  ])('parses %s into integer cents', (value, expected) => {
    expect(parseEuroCents(value)).toBe(expected);
  });
  it.each([
    '1.005',
    '1,000.00',
    '-1',
    'NaN',
    'Infinity',
    '1e3',
    '',
    '.10',
    '1.',
    '20000000.01',
    '99999999999999999',
  ])('rejects %s', (value) => {
    expect(() => parseEuroCents(value)).toThrow();
  });
  it('round-trips the exact upper limit and cents', () => {
    for (const value of [0, 1, 199, 65050, 2_000_000_000])
      expect(parseEuroCents(centsInput(value))).toBe(value);
  });
  it.each([
    [0, '€0.00'],
    [65050, '€650.50'],
    [2_000_000_000, '€20,000,000.00'],
    [9_007_199_254_740_991, '€90,071,992,547,409.91'],
    [9_007_199_254_740_987, '€90,071,992,547,409.87'],
  ])('formats %s cents exactly, including large safe dashboard aggregates', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
  it('rejects unsafe or fractional financial display values', () => {
    for (const cents of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => formatCents(cents)).toThrow('Invalid integer cents.');
    }
    expect(centsInput(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
  });
});

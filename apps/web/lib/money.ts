export const MAX_CENTS = 2_000_000_000;

/** Decimal input is parsed as digits: no binary floating-point euro arithmetic. */
export function parseEuroCents(value: string): number {
  const input = value.trim();
  if (!/^\d{1,8}(?:[.,]\d{1,2})?$/.test(input)) {
    throw new Error('Enter euros with at most two decimal places and no thousands separators.');
  }
  const [whole = '', fraction = ''] = input.replace(',', '.').split('.');
  const cents = Number(whole + fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) {
    throw new Error('The maximum amount is €20,000,000.00.');
  }
  return cents;
}

function exactCents(cents: number): bigint {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Invalid integer cents.');
  return BigInt(cents);
}

export function centsInput(cents: number): string {
  const exact = exactCents(cents);
  return `${exact / 100n}.${String(exact % 100n).padStart(2, '0')}`;
}

const euroFormatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

export function formatCents(cents: number): string {
  const exact = exactCents(cents);
  const fraction = String(exact % 100n).padStart(2, '0');
  // Format only whole euros as BigInt; dividing a large aggregate as Number loses cents.
  return euroFormatter
    .formatToParts(exact / 100n)
    .map((part) => (part.type === 'fraction' ? fraction : part.value))
    .join('');
}

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const parameters = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const keyLength = 32;
let running = 0;
const waiting: (() => void)[] = [];

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  // Each derivation uses about 128 MiB. Bound both concurrency and queued work.
  if (running >= 2) {
    if (waiting.length >= 16) throw new Error('Password service is busy.');
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running += 1;
  }
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, keyLength, parameters, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${parameters.N}$${parameters.r}$${parameters.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  // Only the implemented bounded work factor is accepted; stored data cannot request
  // arbitrary memory/CPU parameters during verification.
  const match = /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded);
  if (!match?.[1] || !match[2]) return false;
  const actual = await derive(password, Buffer.from(match[1], 'hex'));
  return timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
}

export const dummyPasswordHash = `scrypt$131072$8$1$${'00'.repeat(16)}$${'00'.repeat(32)}`;

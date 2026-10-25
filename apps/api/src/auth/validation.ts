import { BadRequestException } from '@nestjs/common';
import type { UserRole } from '@furniture-delivery/contracts';

export function objectPayload(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('A JSON object is required.');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    throw new BadRequestException('Payload contains unsupported fields.');
  }
  return record;
}

export function usernameValue(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('Invalid username.');
  const username = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,63}$/.test(username)) {
    throw new BadRequestException(
      'Username must contain 3–64 letters, digits, dots, hyphens or underscores.',
    );
  }
  return username;
}

export function passwordValue(value: unknown, creating = false): string {
  if (
    typeof value !== 'string' ||
    value.length < (creating ? 12 : 1) ||
    value.length > 128 ||
    Buffer.byteLength(value, 'utf8') > 512
  ) {
    throw new BadRequestException(
      creating ? 'Password must contain 12–128 characters.' : 'Invalid password.',
    );
  }
  return value;
}

export function displayNameValue(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 120) {
    throw new BadRequestException('Display name must contain 1–120 characters.');
  }
  return value.trim();
}

export function roleValue(value: unknown): UserRole {
  if (value !== 'ADMIN' && value !== 'DISPATCHER' && value !== 'CREW_MEMBER') {
    throw new BadRequestException('Invalid role.');
  }
  return value;
}

export function activeValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException('Active must be a boolean.');
  return value;
}

export function uuidValue(value: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) {
    throw new BadRequestException('Invalid identifier.');
  }
  return value;
}

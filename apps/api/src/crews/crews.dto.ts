import { BadRequestException } from '@nestjs/common';
import type {
  AddCrewMemberRequest,
  CreateCrewRequest,
  CreateExternalContactRequest,
  UpdateCrewMembershipRequest,
  UpdateCrewRequest,
  UpdateExternalContactRequest,
  WorkEnvironment,
} from '@furniture-delivery/contracts';

function object(
  value: unknown,
  allowed: readonly string[],
  partial = false,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('A JSON object is required.');
  }
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.some((key) => !allowed.includes(key))) {
    throw new BadRequestException('The request contains unsupported fields.');
  }
  if (partial && keys.length === 0) throw new BadRequestException('Provide at least one field.');
  return body;
}

function text(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > maximum) {
    throw new BadRequestException(`${name} must contain between 1 and ${maximum} characters.`);
  }
  return value.trim();
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException('active must be a boolean.');
  return value;
}

function environment(value: unknown): WorkEnvironment {
  if (value !== 'INDOOR' && value !== 'OUTDOOR') {
    throw new BadRequestException('workEnvironment must be INDOOR or OUTDOOR.');
  }
  return value;
}

function optionalContact(value: unknown, name: 'phone' | 'email'): string | null {
  if (value === null || value === '') return null;
  const result = text(value, name, name === 'phone' ? 40 : 254);
  if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
    throw new BadRequestException('email must be a valid email address.');
  }
  if (name === 'phone' && !/^[+0-9().\s-]+$/.test(result)) {
    throw new BadRequestException('phone contains unsupported characters.');
  }
  return result;
}

/** Explicit parsers run in both tsx development and compiled builds without reflection. */
export class CrewDto {
  static create(value: unknown): CreateCrewRequest {
    const body = object(value, ['code', 'name', 'workEnvironment', 'serviceArea', 'active']);
    const code = text(body.code, 'code', 32);
    if (!/^[A-Z][A-Z0-9_-]{2,31}$/.test(code)) {
      throw new BadRequestException(
        'code must be 3–32 uppercase letters, digits, underscores or hyphens.',
      );
    }
    return {
      code,
      name: text(body.name, 'name', 120),
      workEnvironment: environment(body.workEnvironment),
      serviceArea: text(body.serviceArea, 'serviceArea', 2000),
      ...(Object.hasOwn(body, 'active') ? { active: boolean(body.active) } : {}),
    };
  }

  static update(value: unknown): UpdateCrewRequest {
    const body = object(value, ['name', 'workEnvironment', 'serviceArea', 'active'], true);
    return {
      ...(Object.hasOwn(body, 'name') ? { name: text(body.name, 'name', 120) } : {}),
      ...(Object.hasOwn(body, 'workEnvironment')
        ? { workEnvironment: environment(body.workEnvironment) }
        : {}),
      ...(Object.hasOwn(body, 'serviceArea')
        ? { serviceArea: text(body.serviceArea, 'serviceArea', 2000) }
        : {}),
      ...(Object.hasOwn(body, 'active') ? { active: boolean(body.active) } : {}),
    };
  }

  static addMember(value: unknown): AddCrewMemberRequest {
    const body = object(value, ['userId']);
    if (
      typeof body.userId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.userId,
      )
    ) {
      throw new BadRequestException('userId must be a UUID.');
    }
    return { userId: body.userId };
  }

  static membership(value: unknown): UpdateCrewMembershipRequest {
    const body = object(value, ['active']);
    return { active: boolean(body.active) };
  }

  static createContact(value: unknown): CreateExternalContactRequest {
    const body = object(value, ['name', 'specialty', 'phone', 'email', 'active']);
    return {
      name: text(body.name, 'name', 120),
      specialty: text(body.specialty, 'specialty', 120),
      ...(Object.hasOwn(body, 'phone') ? { phone: optionalContact(body.phone, 'phone') } : {}),
      ...(Object.hasOwn(body, 'email') ? { email: optionalContact(body.email, 'email') } : {}),
      ...(Object.hasOwn(body, 'active') ? { active: boolean(body.active) } : {}),
    };
  }

  static updateContact(value: unknown): UpdateExternalContactRequest {
    const body = object(value, ['name', 'specialty', 'phone', 'email', 'active'], true);
    return {
      ...(Object.hasOwn(body, 'name') ? { name: text(body.name, 'name', 120) } : {}),
      ...(Object.hasOwn(body, 'specialty')
        ? { specialty: text(body.specialty, 'specialty', 120) }
        : {}),
      ...(Object.hasOwn(body, 'phone') ? { phone: optionalContact(body.phone, 'phone') } : {}),
      ...(Object.hasOwn(body, 'email') ? { email: optionalContact(body.email, 'email') } : {}),
      ...(Object.hasOwn(body, 'active') ? { active: boolean(body.active) } : {}),
    };
  }
}

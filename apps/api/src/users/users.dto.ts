import { BadRequestException } from '@nestjs/common';
import type { CreateUserRequest, UpdateUserRequest } from '@furniture-delivery/contracts';
import {
  activeValue,
  displayNameValue,
  objectPayload,
  passwordValue,
  roleValue,
  usernameValue,
} from '../auth/validation';

export function parseCreateUser(body: unknown): CreateUserRequest {
  const value = objectPayload(body, ['username', 'displayName', 'password', 'role', 'active']);
  return {
    username: usernameValue(value.username),
    displayName: displayNameValue(value.displayName),
    password: passwordValue(value.password, true),
    role: roleValue(value.role),
    active: value.active === undefined ? true : activeValue(value.active),
  };
}

export function parseUpdateUser(body: unknown): UpdateUserRequest {
  const value = objectPayload(body, ['displayName', 'password', 'role', 'active']);
  if (Object.keys(value).length === 0) throw new BadRequestException('Provide at least one field.');
  const result: UpdateUserRequest = {};
  if ('displayName' in value) result.displayName = displayNameValue(value.displayName);
  if ('password' in value) result.password = passwordValue(value.password, true);
  if ('role' in value) result.role = roleValue(value.role);
  if ('active' in value) result.active = activeValue(value.active);
  return result;
}

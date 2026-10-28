import { BadRequestException } from '@nestjs/common';
import type {
  CreateOrderRequest,
  CreatePaymentRequest,
  OrderFields,
  OrderItemInput,
  OrderListQuery,
  PaymentMethod,
  PaymentStatus,
  PlanningProgress,
  ServiceType,
  UpdateOrderRequest,
  VoidPaymentRequest,
} from '@furniture-delivery/contracts';
import { objectPayload, uuidValue } from '../auth/validation';

import { MAX_CENTS } from './order-finance';
const fields = [
  'customerName',
  'contactName',
  'phoneNumbers',
  'email',
  'address',
  'city',
  'country',
  'postalCode',
  'serviceType',
  'workDescription',
  'estimatedDurationMinutes',
  'floor',
  'hasElevator',
  'easyAccess',
  'parkingAvailable',
  'accessRestrictions',
  'accessNotes',
  'internalNotes',
  'crewNotes',
  'orderTotalCents',
] as const;
const services: ServiceType[] = ['DELIVERY_ONLY', 'DELIVERY_AND_ASSEMBLY'];
const statuses: PaymentStatus[] = ['NOT_REQUIRED', 'UNPAID', 'PARTIALLY_PAID', 'PAID'];
const methods: PaymentMethod[] = ['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER'];

function text(value: unknown, field: string, max: number, required = false): string {
  if (
    typeof value !== 'string' ||
    value.trim().length > max ||
    (required && value.trim().length === 0)
  )
    throw new BadRequestException(
      `${field} must contain ${required ? '1' : '0'}–${max} characters.`,
    );
  return value.trim();
}
function nullableText(value: unknown, field: string, max: number): string | null {
  return value === null || value === undefined || value === ''
    ? null
    : text(value, field, max) || null;
}
export function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new BadRequestException(`${field} must be an integer between ${min} and ${max}.`);
  return value;
}
function enumValue<T extends string>(value: unknown, field: string, allowed: T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    throw new BadRequestException(`Invalid ${field}.`);
  return value as T;
}
function nullableBoolean(value: unknown, field: string): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean')
    throw new BadRequestException(`${field} must be true, false or null.`);
  return value;
}
function fieldValues(record: Record<string, unknown>, partial: boolean): Partial<OrderFields> {
  const result: Partial<OrderFields> = {};
  const has = (key: string) => !partial || Object.hasOwn(record, key);
  for (const [key, max] of [
    ['customerName', 200],
    ['address', 500],
    ['city', 120],
    ['country', 120],
    ['workDescription', 4000],
  ] as const)
    if (has(key)) result[key] = text(record[key], key, max, true);
  for (const [key, max] of [
    ['contactName', 200],
    ['email', 254],
    ['postalCode', 24],
    ['floor', 40],
  ] as const)
    if (has(key)) result[key] = nullableText(record[key], key, max);
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))
    throw new BadRequestException('Invalid email.');
  for (const key of ['accessRestrictions', 'accessNotes', 'internalNotes', 'crewNotes'] as const)
    if (has(key)) result[key] = text(record[key] ?? '', key, 4000);
  for (const key of ['hasElevator', 'easyAccess', 'parkingAvailable'] as const)
    if (has(key)) result[key] = nullableBoolean(record[key], key);
  if (has('serviceType'))
    result.serviceType = enumValue(record.serviceType, 'serviceType', services);
  if (has('estimatedDurationMinutes'))
    result.estimatedDurationMinutes = integer(
      record.estimatedDurationMinutes,
      'estimatedDurationMinutes',
      1,
      10080,
    );
  if (has('orderTotalCents'))
    result.orderTotalCents = integer(record.orderTotalCents, 'orderTotalCents', 0, MAX_CENTS);
  if (has('phoneNumbers')) {
    if (
      !Array.isArray(record.phoneNumbers) ||
      record.phoneNumbers.length < 1 ||
      record.phoneNumbers.length > 5
    )
      throw new BadRequestException('phoneNumbers must contain 1–5 numbers.');
    result.phoneNumbers = record.phoneNumbers.map((value) => text(value, 'phoneNumbers', 40, true));
  }
  return result;
}
function itemsValue(value: unknown, creating: boolean): OrderItemInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100)
    throw new BadRequestException('items must contain 1–100 positions.');
  const result = value.map((entry): OrderItemInput => {
    const item = objectPayload(entry, [
      'id',
      'description',
      'quantity',
      'configuration',
      'ambient',
      'notes',
      'requiresAssembly',
      'sortOrder',
    ]);
    if (creating && item.id !== undefined)
      throw new BadRequestException('New items cannot supply IDs.');
    if (typeof item.requiresAssembly !== 'boolean')
      throw new BadRequestException('requiresAssembly must be a boolean.');
    return {
      ...(item.id === undefined
        ? {}
        : {
            id:
              typeof item.id === 'string'
                ? uuidValue(item.id)
                : (() => {
                    throw new BadRequestException('Invalid item id.');
                  })(),
          }),
      description: text(item.description, 'description', 1000, true),
      quantity: integer(item.quantity, 'quantity', 1, 10000),
      configuration: text(item.configuration ?? '', 'configuration', 2000),
      ambient: text(item.ambient ?? '', 'ambient', 120),
      notes: text(item.notes ?? '', 'notes', 2000),
      requiresAssembly: item.requiresAssembly,
      sortOrder: integer(item.sortOrder, 'sortOrder', 0, 9999),
    };
  });
  const ids = result.flatMap((item) => (item.id ? [item.id] : []));
  if (new Set(ids).size !== ids.length) throw new BadRequestException('Item IDs must be unique.');
  if (new Set(result.map((item) => item.sortOrder)).size !== result.length)
    throw new BadRequestException('Item display order must be unique.');
  return result;
}
export function validateAssembly(
  serviceType: ServiceType,
  items: readonly { requiresAssembly: boolean }[],
): void {
  if (serviceType === 'DELIVERY_ONLY' && items.some((item) => item.requiresAssembly))
    throw new BadRequestException('Delivery-only orders cannot contain assembly work.');
}
export class OrderDto {
  static create(value: unknown): CreateOrderRequest {
    const record = objectPayload(value, [...fields, 'items']);
    const input = {
      ...fieldValues(record, false),
      items: itemsValue(record.items, true),
    } as CreateOrderRequest;
    validateAssembly(input.serviceType, input.items);
    return input;
  }
  static update(value: unknown): UpdateOrderRequest {
    const record = objectPayload(value, [...fields, 'items', 'expectedVersion']);
    const expectedVersion = integer(record.expectedVersion, 'expectedVersion', 1, 2147483646);
    if (Object.keys(record).length < 2)
      throw new BadRequestException('At least one changed field is required.');
    return {
      ...fieldValues(record, true),
      expectedVersion,
      ...(record.items === undefined ? {} : { items: itemsValue(record.items, false) }),
    };
  }
  static payment(value: unknown): CreatePaymentRequest {
    const record = objectPayload(value, [
      'amountCents',
      'paidOn',
      'method',
      'note',
      'idempotencyKey',
    ]);
    const paidOn = text(record.paidOn, 'paidOn', 10, true);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(paidOn) ||
      paidOn < '1900-01-01' ||
      paidOn > '9999-12-31' ||
      !Number.isFinite(Date.parse(paidOn + 'T00:00:00Z')) ||
      new Date(paidOn + 'T00:00:00Z').toISOString().slice(0, 10) !== paidOn
    )
      throw new BadRequestException('paidOn must be a valid YYYY-MM-DD calendar date (1900–9999).');
    const idempotencyKey = text(record.idempotencyKey, 'idempotencyKey', 100, true);
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(idempotencyKey))
      throw new BadRequestException(
        'idempotencyKey must contain 8–100 letters, digits, underscores or hyphens.',
      );
    return {
      amountCents: integer(record.amountCents, 'amountCents', 1, MAX_CENTS),
      paidOn,
      method: enumValue(record.method, 'method', methods),
      note: nullableText(record.note, 'note', 2000),
      idempotencyKey,
    };
  }
  static void(value: unknown): VoidPaymentRequest {
    const record = objectPayload(value, ['reason']);
    return { reason: text(record.reason, 'reason', 1000, true) };
  }
  static query(
    value: unknown,
  ): OrderListQuery & { search: string; page: number; pageSize: number } {
    const record = objectPayload(value, [
      'search',
      'serviceType',
      'paymentStatus',
      'progress',
      'hasOpenIssues',
      'page',
      'pageSize',
    ]);
    const numeric = (key: string, fallback: number, max: number) =>
      record[key] === undefined
        ? fallback
        : typeof record[key] === 'string' && /^[1-9]\d*$/.test(record[key])
          ? integer(Number(record[key]), key, 1, max)
          : (() => {
              throw new BadRequestException(`Invalid ${key}.`);
            })();
    return {
      search: record.search === undefined ? '' : text(record.search, 'search', 200),
      serviceType:
        record.serviceType === undefined
          ? undefined
          : enumValue(record.serviceType, 'serviceType', services),
      paymentStatus:
        record.paymentStatus === undefined
          ? undefined
          : enumValue(record.paymentStatus, 'paymentStatus', statuses),
      progress:
        record.progress === undefined
          ? undefined
          : enumValue<PlanningProgress>(record.progress, 'progress', [
              'INBOX',
              'PLANNED',
              'ASSIGNED',
              'IN_PROGRESS',
              'PARTIALLY_COMPLETED',
              'REQUIRES_ATTENTION',
              'AWAITING_REVIEW',
              'COMPLETED',
            ]),
      hasOpenIssues:
        record.hasOpenIssues === undefined
          ? undefined
          : record.hasOpenIssues === 'true'
            ? true
            : record.hasOpenIssues === 'false'
              ? false
              : (() => {
                  throw new BadRequestException('hasOpenIssues must be true or false.');
                })(),
      page: numeric('page', 1, 1000000),
      pageSize: numeric('pageSize', 20, 100),
    };
  }
}

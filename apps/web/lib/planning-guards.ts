import type {
  AppointmentDetail,
  CalendarResponse,
  CrewAvailabilityResponse,
  TaskTemplateListResponse,
  TaskTemplateResponse,
  TaskTemplateRecord,
  PlannedTaskRecord,
  AssignmentRecord,
} from '@furniture-delivery/contracts';
import {
  isAssignmentExecution,
  isAppointmentExecution,
  oneOf,
  positiveVersion,
} from './execution-record-guards';
const obj = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string';
const nullable = (value: unknown) => value === null || text(value);
const int = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const severity = (value: unknown) => ['LOW', 'MEDIUM', 'HIGH'].includes(String(value));
const service = (value: unknown) =>
  ['DELIVERY_ONLY', 'DELIVERY_AND_ASSEMBLY'].includes(String(value));
export function isPlannedTask(value: unknown): value is PlannedTaskRecord {
  return (
    obj(value) &&
    ['id', 'assignmentId', 'name', 'description', 'createdAt', 'updatedAt'].every((key) =>
      text(value[key]),
    ) &&
    nullable(value.templateId) &&
    (value.sourceTaskId === undefined || nullable(value.sourceTaskId)) &&
    (value.returnScopeKey === undefined || nullable(value.returnScopeKey)) &&
    typeof value.required === 'boolean' &&
    typeof value.active === 'boolean' &&
    severity(value.severity) &&
    int(value.priority) &&
    oneOf(value.resultStatus, ['PENDING', 'DONE', 'SKIPPED']) &&
    positiveVersion(value.resultVersion) &&
    ['doneBy', 'doneAt', 'resultReason'].every((key) => nullable(value[key]))
  );
}
export function isAssignment(value: unknown): value is AssignmentRecord {
  return (
    obj(value) &&
    ['id', 'appointmentId', 'crewId', 'crewCode', 'crewName', 'createdAt', 'updatedAt'].every(
      (key) => text(value[key]),
    ) &&
    typeof value.crewActive === 'boolean' &&
    ['ASSIGNED', 'CANCELLED'].includes(String(value.status)) &&
    int(value.travelBufferMinutes) &&
    isAssignmentExecution(value.execution) &&
    ['cancelledAt', 'cancelledBy', 'cancelReason'].every((key) => nullable(value[key])) &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isPlannedTask)
  );
}
export function isAppointmentDetail(value: unknown): value is AppointmentDetail {
  return (
    obj(value) &&
    [
      'id',
      'orderId',
      'orderNumber',
      'customerName',
      'city',
      'plannedStartAt',
      'plannedEndAt',
      'notes',
      'createdBy',
      'updatedBy',
      'createdAt',
      'updatedAt',
    ].every((key) => text(value[key])) &&
    service(value.serviceType) &&
    (value.returnRequestId === undefined || nullable(value.returnRequestId)) &&
    int(value.durationMinutes) &&
    int(value.version) &&
    ['SCHEDULED', 'CANCELLED'].includes(String(value.status)) &&
    ['NEEDS_CONFIRMATION', 'CONFIRMED'].includes(String(value.confirmationStatus)) &&
    ['confirmedAt', 'confirmedBy', 'cancelledAt', 'cancelledBy', 'cancelReason'].every((key) =>
      nullable(value[key]),
    ) &&
    Array.isArray(value.assignments) &&
    value.assignments.every(isAssignment) &&
    typeof value.needsAttention === 'boolean' &&
    isAppointmentExecution(value.execution) &&
    Array.isArray(value.attention) &&
    value.attention.every(
      (row) =>
        obj(row) &&
        text(row.crewId) &&
        text(row.message) &&
        [
          'CREW_INACTIVE',
          'OUTSIDE_WORKING_WINDOW',
          'UNAVAILABLE',
          'BOOKING_CONFLICT',
          'UNKNOWN_RELEASE',
          'PREDICTED_CONFLICT',
        ].includes(String(row.code)),
    )
  );
}
export function isCalendarResponse(value: unknown): value is CalendarResponse {
  return (
    obj(value) &&
    value.timeZone === 'Europe/Rome' &&
    text(value.from) &&
    text(value.to) &&
    Array.isArray(value.appointments) &&
    value.appointments.every(isAppointmentDetail)
  );
}
export function isTaskTemplate(value: unknown): value is TaskTemplateRecord {
  return (
    obj(value) &&
    ['id', 'code', 'name', 'description', 'createdAt', 'updatedAt'].every((key) =>
      text(value[key]),
    ) &&
    typeof value.active === 'boolean' &&
    typeof value.required === 'boolean' &&
    severity(value.severity) &&
    int(value.defaultPriority) &&
    ['ALL', 'DELIVERY_ONLY', 'DELIVERY_AND_ASSEMBLY'].includes(String(value.applicability)) &&
    nullable(value.createdBy) &&
    nullable(value.updatedBy)
  );
}
export function isTaskTemplateListResponse(value: unknown): value is TaskTemplateListResponse {
  return obj(value) && Array.isArray(value.templates) && value.templates.every(isTaskTemplate);
}
export function isTaskTemplateResponse(value: unknown): value is TaskTemplateResponse {
  return obj(value) && isTaskTemplate(value.template);
}
export function isCrewAvailabilityResponse(value: unknown): value is CrewAvailabilityResponse {
  if (!obj(value) || !obj(value.config)) return false;
  const config = value.config;
  return (
    text(config.crewId) &&
    int(config.travelBufferMinutes) &&
    int(config.version) &&
    nullable(config.updatedBy) &&
    text(config.createdAt) &&
    text(config.updatedAt) &&
    Array.isArray(config.weeklyWindows) &&
    config.weeklyWindows.every(
      (window) =>
        obj(window) && int(window.weekday) && text(window.startTime) && text(window.endTime),
    ) &&
    Array.isArray(value.unavailability) &&
    value.unavailability.every(
      (row) =>
        obj(row) &&
        [
          'id',
          'crewId',
          'startAt',
          'endAt',
          'reason',
          'createdBy',
          'updatedBy',
          'createdAt',
          'updatedAt',
        ].every((key) => text(row[key])) &&
        typeof row.active === 'boolean',
    ) &&
    Array.isArray(value.affectedAppointments) &&
    value.affectedAppointments.every(isAppointmentDetail)
  );
}

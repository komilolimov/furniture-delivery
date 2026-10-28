import { markExecution } from '../realtime/realtime-marks';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ApplyRescheduleCommand,
  ApplyRescheduleResponse,
  EstimateCommand,
  EstimateResponse,
  RiskBoardResponse,
  RiskQuery,
  RiskReason,
  RiskVisit,
  SlotCandidate,
  SlotSearchQuery,
  SlotSearchResponse,
} from '@furniture-delivery/contracts';
import { DateTime } from 'luxon';
import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import { DatabaseService } from '../database/database.service';
import { Crew } from '../crews/crew.entity';
import { Order } from '../orders/order.entity';
import { ActivityLog } from '../orders/activity-log.entity';
import { Appointment } from '../planning/appointment.entity';
import { CrewAssignment } from '../planning/crew-assignment.entity';
import { PlanningConflict } from '../planning/planning-errors';
import {
  BUSINESS_ZONE,
  localToUtc,
  resolveLocalWindow,
  validateRange,
} from '../planning/planning-time';
import {
  activeReservation,
  readCrewReservationState,
  releaseForReservation,
  startForReservation,
  reservationIssues,
  type CrewReservationState,
  type ReservedAssignment,
} from '../planning/crew-reservations';
import {
  authorizeCrewAssignment,
  lockExecutionUser,
  type ExecutionActor,
  type CrewExecutionContext,
} from '../execution/execution-access';
import {
  executionFingerprint,
  findExecutionReceipt,
  mapExecutionReceipt,
  saveExecutionReceipt,
} from '../execution/execution-receipts';
import { ReturnVisitRequest } from '../execution/return-visit-request.entity';
import type { ExecutionReceipt } from '../execution/execution-receipt.entity';
import { PlanningService } from '../planning/planning.service';
import {
  evidenceFingerprint,
  findEvidenceReceipt,
  mapEvidenceReceipt,
  saveEvidenceReceipt,
} from '../evidence/evidence-receipts';

function conflict(code: string, message: string): never {
  throw new PlanningConflict(code, message);
}
function estimateResult(assignment: CrewAssignment, receipt?: ExecutionReceipt): EstimateResponse {
  return {
    assignmentId: assignment.id,
    estimatedFinishAt: assignment.estimatedFinishAt?.toISOString() ?? null,
    estimateUpdatedAt: assignment.estimateUpdatedAt?.toISOString() ?? null,
    estimateUpdatedBy: assignment.estimateUpdatedBy,
    estimateReason: assignment.estimateReason,
    estimateVersion: assignment.estimateVersion,
    ...(receipt ? { receipt: mapExecutionReceipt(receipt) } : {}),
  };
}

/** These mutations use the M5 User → Order → Appointment → Crew → Assignment lock order. */
async function backofficeAssignment(
  manager: EntityManager,
  actor: ExecutionActor,
  id: string,
): Promise<CrewExecutionContext> {
  await lockExecutionUser(manager, actor);
  const initial = await manager.getRepository(CrewAssignment).findOneBy({ id });
  const visit =
    initial && (await manager.getRepository(Appointment).findOneBy({ id: initial.appointmentId }));
  if (!initial || !visit) throw new NotFoundException('Assignment not found.');
  const lock = { lock: { mode: 'pessimistic_write' as const } };
  const order = await manager
    .getRepository(Order)
    .findOne({ where: { id: visit.orderId }, ...lock });
  const appointment = await manager
    .getRepository(Appointment)
    .findOne({ where: { id: visit.id }, ...lock });
  const crew = await manager
    .getRepository(Crew)
    .findOne({ where: { id: initial.crewId }, ...lock });
  const assignment = await manager
    .getRepository(CrewAssignment)
    .findOne({ where: { id }, ...lock });
  const user = await lockExecutionUser(manager, actor);
  if (
    !order ||
    !appointment ||
    !crew ||
    !assignment ||
    assignment.status !== 'ASSIGNED' ||
    appointment.status !== 'SCHEDULED'
  )
    throw new NotFoundException('Assignment not found.');
  return { order, appointment, crew, assignment, user };
}

function reasonFor(
  row: ReservedAssignment,
  state: CrewReservationState,
  now: Date,
  code: RiskReason['code'],
  message: string,
): RiskReason {
  const release = releaseForReservation(row, now);
  return {
    code,
    crewId: state.crew.id,
    crewName: state.crew.name,
    sourceAssignmentId: row.assignmentId,
    sourceAppointmentId: row.appointmentId,
    sourcePlannedStartAt: row.plannedStartAt.toISOString(),
    sourcePlannedEndAt: row.plannedEndAt.toISOString(),
    sourceEstimatedFinishAt: row.estimatedFinishAt?.toISOString() ?? null,
    sourceActualEndAt: row.actualEndAt?.toISOString() ?? null,
    travelBufferMinutes: row.travelBufferMinutes,
    expectedReleaseAt: release.releaseAt?.toISOString() ?? null,
    basis: release.basis,
    message,
  };
}

@Injectable()
export class ReschedulingService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlanningService) private readonly planning: PlanningService,
  ) {}

  async apply(
    actor: ExecutionActor,
    orderId: string,
    appointmentId: string,
    command: ApplyRescheduleCommand,
  ): Promise<ApplyRescheduleResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      await lockExecutionUser(manager, actor);
      const order = await manager
        .getRepository(Order)
        .findOne({ where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
      const visit = await manager
        .getRepository(Appointment)
        .findOne({ where: { id: appointmentId, orderId }, lock: { mode: 'pessimistic_write' } });
      if (!order || !visit) throw new NotFoundException('Appointment not found for this order.');
      await lockExecutionUser(manager, actor);
      const fingerprint = evidenceFingerprint({ appointmentId, ...command });
      const prior = await findEvidenceReceipt(
        manager,
        actor.id,
        orderId,
        'APPOINTMENT_RESCHEDULED',
        command.operationKey,
        fingerprint,
      );
      if (prior)
        return {
          ...(await this.planning.responseInTransaction(manager, orderId, appointmentId)),
          receipt: mapEvidenceReceipt(prior),
        };
      const response = await this.planning.updateInTransaction(
        manager,
        orderId,
        appointmentId,
        {
          expectedVersion: command.expectedVersion,
          localStart: command.localStart,
          durationMinutes: command.durationMinutes,
          crewIds: command.crewIds,
          reason: command.reason,
        },
        actor.id,
        actor.sessionId,
        { requireUnstarted: true, rejectPastStart: true },
      );
      await manager.save(
        ActivityLog,
        manager.create(ActivityLog, {
          orderId,
          actorId: actor.id,
          action: 'APPOINTMENT_RESCHEDULED',
          targetId: appointmentId,
          reason: command.reason,
          changes: {
            before: {
              plannedStartAt: visit.plannedStartAt.toISOString(),
              plannedEndAt: visit.plannedEndAt.toISOString(),
            },
            after: {
              plannedStartAt: response.appointment.plannedStartAt,
              plannedEndAt: response.appointment.plannedEndAt,
              crewIds: command.crewIds,
            },
          },
        }),
      );
      const receipt = await saveEvidenceReceipt(
        manager,
        actor.id,
        orderId,
        'APPOINTMENT_RESCHEDULED',
        command.operationKey,
        fingerprint,
        appointmentId,
      );
      return { ...response, receipt: mapEvidenceReceipt(receipt) };
    });
  }

  async estimate(
    actor: ExecutionActor,
    assignmentId: string,
    command: EstimateCommand,
    crewMode: boolean,
  ): Promise<EstimateResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      const context = crewMode
        ? await authorizeCrewAssignment(manager, actor, assignmentId, { lock: true })
        : await backofficeAssignment(manager, actor, assignmentId);
      const { assignment, appointment } = context;
      const fingerprint = executionFingerprint(command);
      const prior = await findExecutionReceipt(
        manager,
        actor.id,
        assignmentId,
        'ESTIMATE_SET',
        command.operationKey,
        fingerprint,
      );
      // A late retry returns current state and never applies an old estimate over a newer one.
      if (prior) return estimateResult(assignment, prior);
      if (assignment.estimateVersion !== command.expectedEstimateVersion)
        conflict('STALE_ESTIMATE', 'The estimate changed. Refresh before submitting again.');
      if (!activeReservation(assignment.executionStatus))
        conflict('INVALID_EXECUTION_TRANSITION', 'Only active work can receive an estimate.');
      const now = new Date();
      const estimatedFinishAt =
        command.localFinish === null ? null : localToUtc(command.localFinish);
      if (estimatedFinishAt !== null && estimatedFinishAt <= now)
        throw new BadRequestException('The estimate must be later than server time.');
      if (assignment.estimateVersion >= 2147483647)
        conflict('VERSION_LIMIT', 'Revision limit reached.');
      const before = estimateResult(assignment);
      assignment.estimatedFinishAt = estimatedFinishAt;
      assignment.estimateUpdatedAt = now;
      assignment.estimateUpdatedBy = actor.id;
      assignment.estimateReason = command.reason;
      assignment.estimateVersion++;
      await manager.save(CrewAssignment, assignment);
      await manager.save(
        ActivityLog,
        manager.create(ActivityLog, {
          orderId: appointment.orderId,
          actorId: actor.id,
          action: 'ESTIMATE_SET',
          targetId: assignmentId,
          reason: command.reason.slice(0, 1000),
          changes: { before, after: estimateResult(assignment), reason: command.reason },
        }),
      );
      markExecution(manager, appointment.orderId);
      const receipt = await saveExecutionReceipt(
        manager,
        actor.id,
        assignmentId,
        'ESTIMATE_SET',
        command.operationKey,
        fingerprint,
      );
      return estimateResult(assignment, receipt);
    });
  }

  async risks(actor: ExecutionActor, input: RiskQuery): Promise<RiskBoardResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('REPEATABLE READ', async (manager) => {
      await lockExecutionUser(manager, actor);
      const { from, to } = validateRange(input.from, input.to),
        now = new Date();
      const crews = await manager.getRepository(Crew).find({
        ...(input.allTeams ? {} : { where: { id: In(input.crewIds) } }),
        order: { id: 'ASC' },
        take: 201,
      });
      if (crews.length > 200)
        throw new BadRequestException('Select teams to narrow the risk board.');
      if (!input.allTeams && crews.length !== input.crewIds.length)
        throw new NotFoundException('Team not found.');
      const visits = new Map<string, RiskVisit>();
      const add = (row: ReservedAssignment, state: CrewReservationState, reason: RiskReason) => {
        const ongoingToday = activeReservation(row.executionStatus) && from <= now && now < to;
        if (row.plannedStartAt >= to || (row.plannedEndAt <= from && !ongoingToday)) return;
        let visit = visits.get(row.appointmentId);
        if (!visit) {
          visit = {
            appointmentId: row.appointmentId,
            orderId: row.orderId,
            orderNumber: row.orderNumber,
            plannedStartAt: row.plannedStartAt.toISOString(),
            plannedEndAt: row.plannedEndAt.toISOString(),
            reasons: [],
          };
          visits.set(row.appointmentId, visit);
        }
        if (
          !visit.reasons.some(
            (item) =>
              item.code === reason.code &&
              item.crewId === state.crew.id &&
              item.sourceAssignmentId === reason.sourceAssignmentId,
          )
        )
          visit.reasons.push(reason);
      };
      for (const crew of crews) {
        const state = await readCrewReservationState(manager, crew, from, to);
        for (const row of state.reservations) {
          if (row.executionStatus === 'NOT_STARTED' && row.plannedStartAt < now)
            add(
              row,
              state,
              reasonFor(
                row,
                state,
                now,
                'NOT_DEPARTED',
                'The planned start passed without a departure. Verify the situation.',
              ),
            );
          if (activeReservation(row.executionStatus)) {
            if (row.plannedEndAt < now)
              add(
                row,
                state,
                reasonFor(
                  row,
                  state,
                  now,
                  'OVERRUN',
                  'The planned end passed without completion. The work may be delayed.',
                ),
              );
            if (row.estimatedFinishAt && row.estimatedFinishAt <= now)
              add(
                row,
                state,
                reasonFor(
                  row,
                  state,
                  now,
                  'ESTIMATE_STALE',
                  'The team estimate passed without completion. Request a new estimate.',
                ),
              );
          }
          if (row.executionStatus === 'NOT_STARTED') continue;
          const release = releaseForReservation(row, now);
          if (!release.releaseAt)
            add(row, state, reasonFor(row, state, now, 'UNKNOWN_RELEASE', release.message));
          for (const next of state.reservations) {
            if (
              next.executionStatus !== 'NOT_STARTED' ||
              next.plannedStartAt < startForReservation(row)
            )
              continue;
            if (!release.releaseAt || next.plannedStartAt < release.releaseAt)
              add(
                next,
                state,
                reasonFor(
                  row,
                  state,
                  now,
                  'NEXT_VISIT_AT_RISK',
                  !release.releaseAt
                    ? release.message
                    : 'This visit starts before the team is expected to be free, including its stored travel buffer.',
                ),
              );
          }
        }
      }
      return {
        dataAsOf: now.toISOString(),
        timeZone: BUSINESS_ZONE,
        from: from.toISOString(),
        to: to.toISOString(),
        risks: [...visits.values()].sort(
          (a, b) =>
            a.plannedStartAt.localeCompare(b.plannedStartAt) ||
            a.appointmentId.localeCompare(b.appointmentId),
        ),
      };
    });
  }

  async search(actor: ExecutionActor, input: SlotSearchQuery): Promise<SlotSearchResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('REPEATABLE READ', async (manager) => {
      await lockExecutionUser(manager, actor);
      const order = await manager.getRepository(Order).findOneBy({ id: input.orderId });
      if (!order) throw new NotFoundException('Order not found.');
      let excludeAppointmentId: string | undefined;
      const storedBuffers = new Map<string, number>();
      if (input.context === 'APPOINTMENT') {
        const visit = await manager
          .getRepository(Appointment)
          .findOneBy({ id: input.appointmentId, orderId: order.id });
        if (!visit) throw new NotFoundException('Appointment not found.');
        const assigned = await manager
          .getRepository(CrewAssignment)
          .findBy({ appointmentId: visit.id, status: 'ASSIGNED' });
        if (
          visit.status !== 'SCHEDULED' ||
          assigned.some((a) => a.executionStatus !== 'NOT_STARTED')
        )
          conflict('EXECUTION_STARTED', 'A started or cancelled visit cannot be moved.');
        excludeAppointmentId = visit.id;
        for (const assignment of assigned)
          storedBuffers.set(assignment.crewId, assignment.travelBufferMinutes);
      } else {
        const request = await manager
          .getRepository(ReturnVisitRequest)
          .findOneBy({ id: input.requestId, orderId: order.id });
        if (!request) throw new NotFoundException('Return request not found.');
        if (request.status !== 'OPEN')
          conflict('RETURN_NOT_OPEN', 'Only an open request can be planned.');
      }
      const now = new Date(),
        earliestAt = localToUtc(input.earliestLocal);
      const fromDate = input.from ?? input.earliestLocal.slice(0, 10);
      const toDate =
        input.to ??
        DateTime.fromISO(fromDate, { zone: BUSINESS_ZONE }).plus({ days: 14 }).toISODate()!;
      const { from, to } = validateRange(fromDate, toDate);
      const crews = await manager.getRepository(Crew).find({
        where: input.alternativeCrews ? { active: true } : { id: In(input.crewIds) },
        order: { id: 'ASC' },
        take: 201,
      });
      if (crews.length > 200)
        throw new BadRequestException('Too many alternative teams; select a team explicitly.');
      const requested = await manager.getRepository(Crew).findBy({ id: In(input.crewIds) });
      if (requested.length !== input.crewIds.length) throw new NotFoundException('Team not found.');
      // Include a disabled selected team as an explained empty result, never silently replace it.
      for (const crew of requested)
        if (!crews.some((item) => item.id === crew.id)) crews.push(crew);
      const states = new Map<string, CrewReservationState>();
      const blockedCrews: SlotSearchResponse['blockedCrews'] = [];
      for (const crew of crews) {
        const state = await readCrewReservationState(manager, crew, from, to, excludeAppointmentId);
        states.set(crew.id, state);
        const unknown = state.reservations.find(
          (row) => releaseForReservation(row, now).basis === 'UNKNOWN',
        );
        if (!crew.active || unknown)
          blockedCrews.push({
            crewId: crew.id,
            crewName: crew.name,
            message: !crew.active
              ? 'The team is inactive.'
              : releaseForReservation(unknown!, now).message,
          });
      }
      const blocked = new Set(blockedCrews.map((item) => item.crewId));
      const groups = input.alternativeCrews ? crews.map((crew) => [crew.id]) : [input.crewIds];
      const found: SlotCandidate[] = [];
      for (const group of groups) {
        if (group.some((id) => blocked.has(id))) continue;
        let groupCount = 0;
        for (
          let day = DateTime.fromJSDate(from, { zone: BUSINESS_ZONE });
          day.toJSDate() < to;
          day = day.plus({ days: 1 })
        ) {
          for (let minute = 0; minute < 1440; minute += 15) {
            const localStart = `${day.toISODate()}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
            let window: ReturnType<typeof resolveLocalWindow>;
            try {
              window = resolveLocalWindow(localStart, input.durationMinutes);
            } catch {
              continue;
            }
            if (
              window.plannedStartAt < now ||
              window.plannedStartAt < earliestAt ||
              window.plannedStartAt < from ||
              window.plannedStartAt >= to
            )
              continue;
            const selected = group.map((id) => states.get(id)!);
            const buffers = selected.map(
              (state) => storedBuffers.get(state.crew.id) ?? state.travelBufferMinutes,
            );
            if (
              selected.some(
                (state, index) =>
                  reservationIssues(
                    state,
                    window.plannedStartAt,
                    window.plannedEndAt,
                    buffers[index]!,
                    now,
                  ).length,
              )
            )
              continue;
            const preceding = selected.flatMap((state) =>
              state.reservations
                .filter((row) => row.plannedStartAt < window.plannedStartAt)
                .map((row) => releaseForReservation(row, now)),
            );
            const basis = preceding.some((row) => row.basis === 'ESTIMATE')
              ? 'ESTIMATE'
              : preceding.some((row) => row.basis === 'ACTUAL')
                ? 'ACTUAL'
                : 'PLAN';
            found.push({
              localStart,
              ...window,
              plannedStartAt: window.plannedStartAt.toISOString(),
              plannedEndAt: window.plannedEndAt.toISOString(),
              crewIds: [...group].sort(),
              crews: selected.map((state, index) => ({
                id: state.crew.id,
                code: state.crew.code,
                name: state.crew.name,
                active: state.crew.active,
                serviceArea: state.crew.serviceArea,
                workEnvironment: state.crew.workEnvironment,
                travelBufferMinutes: buffers[index]!,
              })),
              basis,
              notes: [
                ...new Set(preceding.map((row) => row.message)),
                'Availability is rechecked when the dispatcher explicitly saves. This search does not reserve the slot.',
              ],
            });
            if (++groupCount >= 21) break;
          }
          if (groupCount >= 21) break;
        }
      }
      const changes = (candidate: SlotCandidate) =>
        candidate.crewIds.filter((id) => !input.crewIds.includes(id)).length;
      found.sort(
        (a, b) =>
          a.plannedStartAt.localeCompare(b.plannedStartAt) ||
          changes(a) - changes(b) ||
          a.crewIds.join(',').localeCompare(b.crewIds.join(',')),
      );
      return {
        dataAsOf: now.toISOString(),
        timeZone: BUSINESS_ZONE,
        from: fromDate,
        to: toDate,
        earliestAt: earliestAt.toISOString(),
        candidates: found.slice(0, 20),
        limited: found.length > 20,
        blockedCrews,
        message: found.length
          ? null
          : blockedCrews.length
            ? 'No matching windows. Some teams need a current estimate or are inactive; choose another team or update the estimate.'
            : 'No matching working windows in this bounded date range. Try another range or team.',
      };
    });
  }
}

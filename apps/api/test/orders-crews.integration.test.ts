import type {
  AssignedOrderCrew,
  OrderListResponse,
  OrderResponse,
} from '@furniture-delivery/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Crew } from '../src/crews/crew.entity';
import { CrewAssignment } from '../src/planning/crew-assignment.entity';
import {
  completeAcceptanceTasks,
  finishAcceptanceTeam,
  setAcceptanceQuantities,
} from './acceptance-fixture';
import {
  createEvidenceFixture,
  evidenceOrderInput,
  evidenceJson as json,
  freshOperation,
  safeEvidence,
  type EvidenceFixture,
} from './evidence-fixture';

const crewProjection = (crew: Crew): AssignedOrderCrew => ({
  id: crew.id,
  code: crew.code,
  name: crew.name,
});
const sortedCrews = (crews: Crew[]) =>
  crews
    .map(crewProjection)
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.id.localeCompare(b.id)));

describe('Orders assigned crews on isolated PostgreSQL', () => {
  let f: EvidenceFixture;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-07T08:00:00.000Z'));
    f = await createEvidenceFixture('m8_workflow', (config, root) => ({
      ...config,
      storage: { ...config.storage, root },
    }));
  });
  afterAll(async () => {
    await f?.close();
    vi.useRealTimers();
  });

  it('returns an empty crew array for an unassigned order and avoids an assignment query for an empty page', async () => {
    const order = await f.orders.create(evidenceOrderInput(), f.dispatcher.user.id);
    expect(order.assignedCrews).toEqual([]);
    expect((await f.orders.detail(order.id)).assignedCrews).toEqual([]);
    const page = await f.orders.list({ search: order.number, pageSize: 1 });
    expect(page.total).toBe(1);
    expect(page.orders[0]?.assignedCrews).toEqual([]);
    const queries = vi.spyOn(f.source.logger, 'logQuery');
    try {
      const empty = await f.orders.list({ search: 'does-not-match-a-synthetic-order' });
      expect(empty.total).toBe(0);
      expect(empty.orders).toEqual([]);
      expect(queries.mock.calls.filter(([sql]) => sql.includes('"orderCrew"'))).toHaveLength(0);
    } finally {
      queries.mockRestore();
    }
  });

  it('batches and deduplicates non-cancelled crews while keeping completed/inactive participation, counts and money', async () => {
    const ctx = await f.context({ crews: 2 });
    const [firstCrew, secondCrew] = ctx.crews as [Crew, Crew];
    const actor = ctx.actors[0]![0]!;
    await f.start(ctx, 0);
    await completeAcceptanceTasks(f, actor, ctx.assignmentIds[0]!);
    await setAcceptanceQuantities(f, actor, ctx.assignmentIds[0]!);
    await finishAcceptanceTeam(f, ctx, 0);
    expect((await f.detail(actor, ctx.assignmentIds[0]!)).execution.status).toBe('COMPLETED');
    await f.orders.recordPayment(
      ctx.order.id,
      {
        amountCents: 5000,
        paidOn: '2030-01-07',
        method: 'CASH',
        idempotencyKey: freshOperation(),
      },
      f.dispatcher.user.id,
    );
    const financesBefore = await f.orders.dashboard();

    // The same first crew on a later visit must still appear only once.
    const duplicate = await f.planning.create(
      ctx.order.id,
      {
        localStart: '2030-01-08T09:00',
        durationMinutes: 60,
        crewIds: [firstCrew.id],
        idempotencyKey: freshOperation(),
      },
      f.dispatcher.user.id,
    );
    const removedCrew = await f.makeCrew();
    const reassigned = await f.planning.create(
      ctx.order.id,
      {
        localStart: '2030-01-09T09:00',
        durationMinutes: 60,
        crewIds: [firstCrew.id, removedCrew.id],
        idempotencyKey: freshOperation(),
      },
      f.dispatcher.user.id,
    );
    await f.planning.update(
      ctx.order.id,
      reassigned.appointment.id,
      {
        expectedVersion: reassigned.appointment.version,
        crewIds: [firstCrew.id],
        reason: 'Synthetic removal of the extra crew',
      },
      f.dispatcher.user.id,
    );
    const cancelledCrew = await f.makeCrew();
    const cancelled = await f.planning.create(
      ctx.order.id,
      {
        localStart: '2030-01-10T09:00',
        durationMinutes: 60,
        crewIds: [cancelledCrew.id],
        idempotencyKey: freshOperation(),
      },
      f.dispatcher.user.id,
    );
    await f.planning.cancel(
      ctx.order.id,
      cancelled.appointment.id,
      cancelled.appointment.version,
      'Synthetic cancelled visit',
      f.dispatcher.user.id,
    );
    // Independently exercise the visit filter with a valid synthetic assigned row under a cancelled visit.
    await f.source.getRepository(CrewAssignment).update(cancelled.appointment.assignments[0]!.id, {
      status: 'ASSIGNED',
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
    });
    await f.source.getRepository(Crew).update(firstCrew.id, { active: false });

    const expected = sortedCrews([firstCrew, secondCrew]);
    const detail = await f.orders.detail(ctx.order.id);
    expect(detail.assignedCrews).toEqual(expected);
    expect((await f.orders.detail(ctx.order.id.toUpperCase())).assignedCrews).toEqual(expected);
    expect(
      detail.appointments.find((visit) => visit.id === duplicate.appointment.id),
    ).toBeDefined();
    const queries = vi.spyOn(f.source.logger, 'logQuery');
    try {
      const page = await f.orders.list({ page: 1, pageSize: 10 });
      expect(page.orders.find((order) => order.id === ctx.order.id)?.assignedCrews).toEqual(
        expected,
      );
      expect(queries.mock.calls.filter(([sql]) => sql.includes('"orderCrew"'))).toHaveLength(1);
      const one = await f.orders.list({ page: 1, pageSize: 1 });
      const two = await f.orders.list({ page: 2, pageSize: 1 });
      expect(one.total).toBe(page.total);
      expect(two.total).toBe(page.total);
      expect(one.orders).toHaveLength(1);
      expect(two.orders).toHaveLength(1);
      expect(one.orders[0]?.id).not.toBe(two.orders[0]?.id);
    } finally {
      queries.mockRestore();
    }
    const filtered = await f.orders.list({ search: ctx.order.number, pageSize: 1 });
    expect(filtered.total).toBe(1);
    expect(filtered.orders[0]).toMatchObject({
      assignedCrews: expected,
      orderTotalCents: 100000,
      paidCents: 5000,
      balanceCents: 95000,
    });
    const financesAfter = await f.orders.dashboard();
    for (const key of ['orderTotalCents', 'paidCents', 'balanceCents'] as const)
      expect(financesAfter[key]).toBe(financesBefore[key]);
  });

  it('exposes the projection only through authorized backoffice responses and leaves the crew response private', async () => {
    const ctx = await f.context({ crews: 2 });
    const response = await json<OrderListResponse>(
      await f.call(f.dispatcher, '/orders?search=' + encodeURIComponent(ctx.order.number)),
    );
    expect(response.orders[0]?.assignedCrews).toEqual(sortedCrews(ctx.crews));
    const detail = await json<OrderResponse>(await f.call(f.dispatcher, '/orders/' + ctx.order.id));
    expect(detail.order.assignedCrews).toEqual(response.orders[0]?.assignedCrews);
    const uppercase = await json<OrderResponse>(
      await f.call(f.dispatcher, '/orders/' + ctx.order.id.toUpperCase()),
    );
    expect(uppercase.order.id).toBe(ctx.order.id);
    expect(uppercase.order.assignedCrews).toEqual(detail.order.assignedCrews);
    const employee = ctx.actors[1]![0]!;
    expect((await f.call(employee, '/orders')).status).toBe(403);
    expect((await f.call(employee, '/orders/' + ctx.order.id)).status).toBe(403);
    const crewDetail = await f.detail(employee, ctx.assignmentIds[1]!);
    safeEvidence(crewDetail);
    expect(crewDetail).not.toHaveProperty('assignedCrews');
    expect(crewDetail.order).not.toHaveProperty('assignedCrews');
  });
});

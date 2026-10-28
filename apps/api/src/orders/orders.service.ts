import { markOrder, markPlanning } from '../realtime/realtime-marks';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ActivityAction,
  AssignedOrderCrew,
  ActivityRecord,
  CreateOrderRequest,
  CreatePaymentRequest,
  DashboardResponse,
  OrderDetail,
  OrderItemInput,
  OrderItemRecord,
  OrderListQuery,
  OrderListResponse,
  OrderSummary,
  PaymentRecord,
  PaymentResponse,
  UpdateOrderRequest,
  PlanningProgress,
} from '@furniture-delivery/contracts';
import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import { DatabaseService } from '../database/database.service';
import { ActivityLog } from './activity-log.entity';
import { OrderItem } from './order-item.entity';
import { Order } from './order.entity';
import { Payment } from './payment.entity';
import { derivePaymentState, paymentFingerprint, safeSumCents } from './order-finance';
import { validateAssembly } from './orders.dto';
import { Appointment } from '../planning/appointment.entity';
import { CrewAssignment } from '../planning/crew-assignment.entity';
import { Crew } from '../crews/crew.entity';
import { readOrderAppointments } from '../planning/planning-projection';
import {
  executionStateSql,
  readOrderExecution,
  readOrderExecutionState,
  type ResolvedExecutionState,
} from '../execution/execution-state';
import { lockExecutionUser } from '../execution/execution-access';

function mapPayment(payment: Payment): PaymentRecord {
  return {
    id: payment.id,
    orderId: payment.orderId,
    amountCents: payment.amountCents,
    paidOn: payment.paidOn,
    method: payment.method,
    note: payment.note,
    status: payment.status,
    createdBy: payment.createdBy,
    createdAt: payment.createdAt.toISOString(),
    voidedBy: payment.voidedBy,
    voidedAt: payment.voidedAt?.toISOString() ?? null,
    voidReason: payment.voidReason,
  };
}
function mapItem(item: OrderItem): OrderItemRecord {
  return {
    id: item.id,
    orderId: item.orderId,
    description: item.description,
    quantity: item.quantity,
    configuration: item.configuration,
    ambient: item.ambient,
    notes: item.notes,
    requiresAssembly: item.requiresAssembly,
    sortOrder: item.sortOrder,
    active: item.active,
    deliveredQuantity: item.deliveredQuantity,
    assembledQuantity: item.assembledQuantity,
    fulfillmentVersion: item.fulfillmentVersion,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
function mapActivity(activity: ActivityLog): ActivityRecord {
  return {
    id: activity.id,
    orderId: activity.orderId,
    actorId: activity.actorId,
    action: activity.action,
    targetId: activity.targetId,
    createdAt: activity.createdAt.toISOString(),
    reason: activity.reason,
    changes: activity.changes,
  };
}
function summary(
  order: Order,
  paidCents: number,
  state: ResolvedExecutionState,
  assignedCrews: AssignedOrderCrew[],
): OrderSummary {
  return {
    id: order.id,
    assignedCrews,
    number: order.number,
    customerName: order.customerName,
    city: order.city,
    serviceType: order.serviceType,
    progress: state.progress,
    currentCompletionId: state.currentCompletionId ?? null,
    workReadyForReview: state.workReadyForReview,
    openIssueCount: state.openIssueCount,
    returnVisitRequired: state.returnVisitRequired,
    orderTotalCents: order.orderTotalCents,
    paidCents,
    balanceCents: order.orderTotalCents - paidCents,
    paymentStatus: derivePaymentState(order.orderTotalCents, paidCents),
    currency: order.currency,
    version: order.version,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
@Injectable()
export class OrdersService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /** One page-bounded read, kept separate from finance/progress/count queries. */
  private async assignedCrews(
    manager: EntityManager,
    orderIds: string[],
  ): Promise<Map<string, AssignedOrderCrew[]>> {
    const result = new Map(orderIds.map((id) => [id, [] as AssignedOrderCrew[]]));
    if (orderIds.length === 0) return result;
    const rows = await manager
      .getRepository(CrewAssignment)
      .createQueryBuilder('orderCrewAssignment')
      .innerJoin(
        Appointment,
        'orderCrewVisit',
        'orderCrewVisit.id = orderCrewAssignment.appointmentId',
      )
      .innerJoin(Crew, 'orderCrew', 'orderCrew.id = orderCrewAssignment.crewId')
      .select('orderCrewVisit.orderId', 'orderId')
      .addSelect('orderCrew.id', 'id')
      .addSelect('orderCrew.code', 'code')
      .addSelect('orderCrew.name', 'name')
      .distinct(true)
      .where('orderCrewVisit.orderId IN (:...orderIds)', { orderIds })
      .andWhere('orderCrewVisit.status = :visitStatus', { visitStatus: 'SCHEDULED' })
      .andWhere('orderCrewAssignment.status = :assignmentStatus', { assignmentStatus: 'ASSIGNED' })
      .orderBy('orderCrew.code', 'ASC')
      .addOrderBy('orderCrew.id', 'ASC')
      .getRawMany<AssignedOrderCrew & { orderId: string }>();
    // Active=false crews remain visible in the history of their assigned visits.
    for (const { orderId, id, code, name } of rows) result.get(orderId)!.push({ id, code, name });
    return result;
  }

  private async lock(manager: EntityManager, id: string): Promise<Order> {
    const order = await manager
      .getRepository(Order)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }
  private async paid(manager: EntityManager, orderId: string): Promise<number> {
    const result = await manager
      .getRepository(Payment)
      .createQueryBuilder('payment')
      .select('COALESCE(SUM(payment.amountCents),0)', 'paid')
      .where('payment.orderId = :orderId AND payment.status = :status', {
        orderId,
        status: 'RECORDED',
      })
      .getRawOne<{ paid: string }>();
    return safeSumCents(result?.paid ?? '0');
  }
  private async audit(
    manager: EntityManager,
    orderId: string,
    actorId: string,
    action: ActivityAction,
    targetId: string,
    changes: Record<string, unknown> = {},
    reason: string | null = null,
  ): Promise<void> {
    await manager.save(
      ActivityLog,
      manager.create(ActivityLog, { orderId, actorId, action, targetId, changes, reason }),
    );
    const publicChange = action.startsWith('ITEM_') || action === 'CONFIRMATION_RESET';
    markOrder(manager, orderId, publicChange);
    if (action === 'CONFIRMATION_RESET') markPlanning(manager, orderId);
  }
  private async touch(manager: EntityManager, order: Order, actorId: string): Promise<void> {
    if (order.version >= 2147483647) throw new ConflictException('Order revision limit reached.');
    order.version += 1;
    order.updatedBy = actorId;
    await manager.save(Order, order);
  }
  async detailIn(manager: EntityManager, id: string): Promise<OrderDetail> {
    const order = await manager.getRepository(Order).findOneBy({ id });
    if (!order) throw new NotFoundException('Order not found.');
    const [items, payments, activity, paid, appointments, state, execution, crews] =
      await Promise.all([
        manager
          .getRepository(OrderItem)
          .find({ where: { orderId: id, active: true }, order: { sortOrder: 'ASC', id: 'ASC' } }),
        manager
          .getRepository(Payment)
          .find({ where: { orderId: id }, order: { createdAt: 'DESC', id: 'DESC' } }),
        manager
          .getRepository(ActivityLog)
          .find({ where: { orderId: id }, order: { createdAt: 'DESC', id: 'DESC' } }),
        this.paid(manager, id),
        readOrderAppointments(manager, id),
        readOrderExecutionState(manager, id),
        readOrderExecution(manager, id),
        this.assignedCrews(manager, [order.id]),
      ]);
    return {
      ...summary(order, paid, state, crews.get(order.id)!),
      contactName: order.contactName,
      phoneNumbers: order.phoneNumbers,
      email: order.email,
      address: order.address,
      country: order.country,
      postalCode: order.postalCode,
      workDescription: order.workDescription,
      estimatedDurationMinutes: order.estimatedDurationMinutes,
      floor: order.floor,
      hasElevator: order.hasElevator,
      easyAccess: order.easyAccess,
      parkingAvailable: order.parkingAvailable,
      accessRestrictions: order.accessRestrictions,
      accessNotes: order.accessNotes,
      internalNotes: order.internalNotes,
      crewNotes: order.crewNotes,
      createdBy: order.createdBy,
      updatedBy: order.updatedBy,
      items: items.map(mapItem),
      payments: payments.map(mapPayment),
      activity: activity.map(mapActivity),
      appointments,
      execution,
    };
  }
  async detail(id: string): Promise<OrderDetail> {
    const source = await this.database.getDataSource();
    return source.transaction('REPEATABLE READ', (manager) => this.detailIn(manager, id));
  }
  async create(
    input: CreateOrderRequest,
    actorId: string,
    sessionId?: string,
  ): Promise<OrderDetail> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      await lockExecutionUser(manager, { id: actorId, sessionId });
      const { items, ...fields } = input;
      validateAssembly(input.serviceType, items);
      const order = await manager.save(
        Order,
        manager.create(Order, {
          ...fields,
          currency: 'EUR',
          version: 1,
          createdBy: actorId,
          updatedBy: actorId,
        }),
      );
      await this.audit(manager, order.id, actorId, 'ORDER_CREATED', order.id, {
        itemCount: items.length,
        orderTotalCents: order.orderTotalCents,
      });
      for (const item of items) {
        if (item.id) throw new BadRequestException('New items cannot supply IDs.');
        const saved = await manager.save(
          OrderItem,
          manager.create(OrderItem, { ...item, orderId: order.id, active: true }),
        );
        await this.audit(manager, order.id, actorId, 'ITEM_ADDED', saved.id, {
          quantity: saved.quantity,
        });
      }
      return this.detailIn(manager, order.id);
    });
  }
  async update(
    id: string,
    input: UpdateOrderRequest,
    actorId: string,
    sessionId?: string,
  ): Promise<OrderDetail> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      await lockExecutionUser(manager, { id: actorId, sessionId });
      const order = await this.lock(manager, id);
      const { expectedVersion, items, ...fields } = input;
      if (order.version !== expectedVersion)
        throw new ConflictException('This order changed. Reload the latest version before saving.');
      const paid = await this.paid(manager, id);
      if ((fields.orderTotalCents ?? order.orderTotalCents) < paid)
        throw new ConflictException('The order total cannot be lower than recorded payments.');
      const previous = await manager
        .getRepository(OrderItem)
        .find({ where: { orderId: id, active: true } });
      const byId = new Map(previous.map((item) => [item.id, item]));
      if (items) {
        for (const item of items)
          if (item.id && !byId.has(item.id))
            throw new NotFoundException(
              'An item does not belong to the current order composition.',
            );
      }
      validateAssembly(fields.serviceType ?? order.serviceType, items ?? previous);
      const conditionFields = [
        'address',
        'city',
        'country',
        'postalCode',
        'serviceType',
        'workDescription',
        'floor',
        'hasElevator',
        'easyAccess',
        'parkingAvailable',
        'accessRestrictions',
        'accessNotes',
      ] as const;
      const changedConditions: string[] = conditionFields.filter(
        (key) => Object.hasOwn(fields, key) && fields[key] !== order[key],
      );
      const itemScope = [
        'description',
        'quantity',
        'configuration',
        'ambient',
        'requiresAssembly',
      ] as const;
      if (
        items &&
        (items.length !== previous.length ||
          items.some((item) => {
            const old = item.id ? byId.get(item.id) : undefined;
            return !old || itemScope.some((key) => old[key] !== item[key]);
          }))
      )
        changedConditions.push('items');
      if (changedConditions.length) {
        const departed = await manager
          .getRepository(CrewAssignment)
          .createQueryBuilder('assignment')
          .innerJoin(Appointment, 'visit', 'visit.id = assignment.appointmentId')
          .where('visit.orderId = :id AND assignment.departedAt IS NOT NULL', { id })
          .getExists();
        if (departed)
          throw new ConflictException(
            'A team has already departed for this order. Delivery conditions and item scope are frozen; contacts, notes and payments may still be updated.',
          );
      }
      const crewChanged = Object.entries(fields).some(
        ([key, value]) =>
          key !== 'orderTotalCents' &&
          key !== 'internalNotes' &&
          JSON.stringify(order[key as keyof Order]) !== JSON.stringify(value),
      );
      Object.assign(order, fields);
      await this.touch(manager, order, actorId);
      await this.audit(manager, id, actorId, 'ORDER_UPDATED', id, {
        fields: Object.keys(fields),
        version: order.version,
      });
      if (crewChanged) markOrder(manager, id, true);
      if (items) await this.replaceItems(manager, id, items, previous, actorId);
      if (changedConditions.length)
        await this.resetConfirmations(manager, id, actorId, changedConditions);
      return this.detailIn(manager, id);
    });
  }
  private async resetConfirmations(
    manager: EntityManager,
    orderId: string,
    actorId: string,
    fields: string[],
  ): Promise<void> {
    // The parent Order is already locked. Never take a Crew lock for metadata-only changes.
    const appointments = await manager
      .getRepository(Appointment)
      .createQueryBuilder('appointment')
      .where(
        'appointment.orderId = :orderId AND appointment.status = :status AND appointment.confirmationStatus = :confirmationStatus',
        { orderId, status: 'SCHEDULED', confirmationStatus: 'CONFIRMED' },
      )
      .orderBy('appointment.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
    for (const appointment of appointments) {
      if (appointment.version >= 2147483647)
        throw new ConflictException('Appointment revision limit reached.');
      const previousConfirmation = {
        confirmedAt: appointment.confirmedAt?.toISOString() ?? null,
        confirmedBy: appointment.confirmedBy,
      };
      appointment.confirmationStatus = 'NEEDS_CONFIRMATION';
      appointment.confirmedAt = null;
      appointment.confirmedBy = null;
      appointment.updatedBy = actorId;
      appointment.version += 1;
      await manager.save(Appointment, appointment);
      await this.audit(
        manager,
        orderId,
        actorId,
        'CONFIRMATION_RESET',
        appointment.id,
        { fields, ...previousConfirmation, appointmentVersion: appointment.version },
        'Order delivery conditions changed. Review duration and tasks, then agree the visit again.',
      );
    }
  }
  private async replaceItems(
    manager: EntityManager,
    orderId: string,
    items: OrderItemInput[],
    previous: OrderItem[],
    actorId: string,
  ): Promise<void> {
    const supplied = new Set(items.flatMap((item) => (item.id ? [item.id] : [])));
    for (const old of previous)
      if (!supplied.has(old.id)) {
        old.active = false;
        await manager.save(OrderItem, old);
        await this.audit(manager, orderId, actorId, 'ITEM_REMOVED', old.id);
      }
    for (const input of items) {
      if (input.id) {
        const old = previous.find((item) => item.id === input.id);
        if (!old) throw new NotFoundException('Item not found.');
        const changed = Object.keys(input).filter(
          (key) =>
            key !== 'id' && old[key as keyof OrderItem] !== input[key as keyof OrderItemInput],
        );
        if (changed.length) {
          Object.assign(old, input);
          await manager.save(OrderItem, old);
          await this.audit(manager, orderId, actorId, 'ITEM_UPDATED', old.id, { fields: changed });
        }
      } else {
        const item = await manager.save(
          OrderItem,
          manager.create(OrderItem, { ...input, orderId, active: true }),
        );
        await this.audit(manager, orderId, actorId, 'ITEM_ADDED', item.id, {
          quantity: item.quantity,
        });
      }
    }
  }
  async recordPayment(
    id: string,
    input: CreatePaymentRequest,
    actorId: string,
    sessionId?: string,
  ): Promise<PaymentResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      await lockExecutionUser(manager, { id: actorId, sessionId });
      const order = await this.lock(manager, id);
      const previous = await manager
        .getRepository(Payment)
        .createQueryBuilder('payment')
        .addSelect('payment.fingerprint')
        .where('payment.orderId = :id AND payment.idempotencyKey = :key', {
          id,
          key: input.idempotencyKey,
        })
        .getOne();
      const fingerprint = paymentFingerprint(input);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new ConflictException(
            'This idempotency key was already used for different payment details.',
          );
        return { payment: mapPayment(previous), order: await this.detailIn(manager, id) };
      }
      const paid = await this.paid(manager, id);
      if (input.amountCents > order.orderTotalCents - paid)
        throw new ConflictException('Payment exceeds the remaining balance.');
      const payment = await manager.save(
        Payment,
        manager.create(Payment, {
          orderId: id,
          amountCents: input.amountCents,
          paidOn: input.paidOn,
          method: input.method,
          note: input.note ?? null,
          idempotencyKey: input.idempotencyKey,
          fingerprint,
          status: 'RECORDED',
          createdBy: actorId,
          voidedBy: null,
          voidedAt: null,
          voidReason: null,
        }),
      );
      await this.touch(manager, order, actorId);
      await this.audit(manager, id, actorId, 'PAYMENT_RECORDED', payment.id, {
        amountCents: payment.amountCents,
      });
      return { payment: mapPayment(payment), order: await this.detailIn(manager, id) };
    });
  }
  async voidPayment(
    id: string,
    paymentId: string,
    reason: string,
    actorId: string,
    sessionId?: string,
  ): Promise<PaymentResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('READ COMMITTED', async (manager) => {
      await lockExecutionUser(manager, { id: actorId, sessionId });
      const order = await this.lock(manager, id);
      const payment = await manager
        .getRepository(Payment)
        .findOneBy({ id: paymentId, orderId: id });
      if (!payment) throw new NotFoundException('Payment not found for this order.');
      if (payment.status === 'VOIDED')
        return { payment: mapPayment(payment), order: await this.detailIn(manager, id) };
      payment.status = 'VOIDED';
      payment.voidedAt = new Date();
      payment.voidedBy = actorId;
      payment.voidReason = reason;
      await manager.save(Payment, payment);
      await this.touch(manager, order, actorId);
      await this.audit(
        manager,
        id,
        actorId,
        'PAYMENT_VOIDED',
        payment.id,
        { amountCents: payment.amountCents },
        reason,
      );
      return { payment: mapPayment(payment), order: await this.detailIn(manager, id) };
    });
  }
  private financialQuery(manager: EntityManager): {
    query: SelectQueryBuilder<Order>;
    paidSql: string;
    progressSql: string;
  } {
    const query = manager.getRepository(Order).createQueryBuilder('orders');
    const paidSql = query
      .subQuery()
      .select('COALESCE(SUM(p.amountCents),0)')
      .from(Payment, 'p')
      .where('p.orderId = orders.id AND p.status = :recorded', { recorded: 'RECORDED' })
      .getQuery();
    query.addSelect(paidSql, 'paidCents');
    const { progressSql, workReadySql, openIssueCountSql, returnVisitRequiredSql } =
      executionStateSql(query, 'orders');
    query
      .addSelect(progressSql, 'planningProgress')
      .addSelect(workReadySql, 'workReadyForReview')
      .addSelect(openIssueCountSql, 'openIssueCount')
      .addSelect(returnVisitRequiredSql, 'returnVisitRequired')
      .addSelect('orders.currentCompletionId', 'currentCompletionId');
    return { query, paidSql, progressSql };
  }
  async list(input: OrderListQuery): Promise<OrderListResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('REPEATABLE READ', async (manager) => {
      const { query, paidSql, progressSql } = this.financialQuery(manager);
      if (input.search)
        query.andWhere(
          '(orders.number ILIKE :search OR orders.customerName ILIKE :search OR orders.city ILIKE :search)',
          { search: `%${input.search.replace(/[\\%_]/g, '\\$&')}%` },
        );
      if (input.serviceType)
        query.andWhere('orders.serviceType = :serviceType', { serviceType: input.serviceType });
      if (input.paymentStatus)
        query.andWhere(
          `(CASE WHEN orders.orderTotalCents = 0 THEN 'NOT_REQUIRED' WHEN ${paidSql} = 0 THEN 'UNPAID' WHEN ${paidSql} = orders.orderTotalCents THEN 'PAID' ELSE 'PARTIALLY_PAID' END) = :paymentStatus`,
          { paymentStatus: input.paymentStatus },
        );
      if (input.progress)
        query.andWhere(`(${progressSql}) = :planningProgress`, {
          planningProgress: input.progress,
        });
      if (input.hasOpenIssues !== undefined) {
        const { openIssueCountSql } = executionStateSql(query, 'orders');
        query.andWhere(`(${openIssueCountSql}) ${input.hasOpenIssues ? '>' : '='} 0`);
      }
      const total = await query.getCount();
      const page = input.page ?? 1,
        pageSize = input.pageSize ?? 20;
      const { entities, raw } = await query
        .orderBy('orders.createdAt', 'DESC')
        .addOrderBy('orders.id', 'DESC')
        .skip((page - 1) * pageSize)
        .take(pageSize)
        .getRawAndEntities<{
          paidCents: string;
          planningProgress: PlanningProgress;
          currentCompletionId: string | null;
          workReadyForReview: boolean;
          openIssueCount: string;
          returnVisitRequired: boolean;
        }>();
      const crews = await this.assignedCrews(
        manager,
        entities.map((order) => order.id),
      );
      return {
        orders: entities.map((order, index) =>
          summary(
            order,
            safeSumCents(raw[index]?.paidCents ?? '0'),
            {
              progress: raw[index]?.planningProgress ?? 'INBOX',
              currentCompletionId: raw[index]?.currentCompletionId ?? null,
              workReadyForReview: raw[index]?.workReadyForReview ?? false,
              openIssueCount: Number(raw[index]?.openIssueCount ?? 0),
              returnVisitRequired: raw[index]?.returnVisitRequired ?? false,
            },
            crews.get(order.id)!,
          ),
        ),
        total,
        page,
        pageSize,
      };
    });
  }
  async dashboard(): Promise<DashboardResponse> {
    const source = await this.database.getDataSource();
    return source.transaction('REPEATABLE READ', async (manager) => {
      const { query, progressSql } = this.financialQuery(manager);
      const { openIssueCountSql, returnVisitRequiredSql } = executionStateSql(query, 'orders');
      const rows = await query
        .select('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(orders.orderTotalCents),0)', 'total')
        .addSelect(`COUNT(*) FILTER (WHERE (${progressSql}) = 'INBOX')`, 'inbox')
        .addSelect(`COUNT(*) FILTER (WHERE (${progressSql}) = 'PLANNED')`, 'planned')
        .addSelect(`COUNT(*) FILTER (WHERE (${progressSql}) = 'ASSIGNED')`, 'assignedCount')
        .addSelect(`COUNT(*) FILTER (WHERE (${progressSql}) = 'IN_PROGRESS')`, 'inProgress')
        .addSelect(`COUNT(*) FILTER (WHERE (${progressSql}) = 'PARTIALLY_COMPLETED')`, 'partial')
        .addSelect(`COUNT(*) FILTER (WHERE (${progressSql}) = 'REQUIRES_ATTENTION')`, 'attention')
        .addSelect(`COUNT(*) FILTER (WHERE (${progressSql}) = 'AWAITING_REVIEW')`, 'review')
        .addSelect('COUNT(*) FILTER (WHERE orders.current_completion_id IS NOT NULL)', 'completed')
        .addSelect(`COALESCE(SUM(${openIssueCountSql}),0)`, 'issues')
        .addSelect(`COUNT(*) FILTER (WHERE ${returnVisitRequiredSql})`, 'returns')
        .getRawOne<{
          count: string;
          total: string;
          inbox: string;
          planned: string;
          assignedCount: string;
          inProgress: string;
          partial: string;
          attention: string;
          review: string;
          completed: string;
          issues: string;
          returns: string;
        }>();
      const paid = await manager
        .getRepository(Payment)
        .createQueryBuilder('payment')
        .select('COALESCE(SUM(payment.amountCents),0)', 'paid')
        .where('payment.status = :recorded', { recorded: 'RECORDED' })
        .getRawOne<{ paid: string }>();
      const total = safeSumCents(rows?.total ?? '0'),
        paidCents = safeSumCents(paid?.paid ?? '0');
      return {
        inboxCount: safeSumCents(rows?.inbox ?? '0'),
        plannedCount: safeSumCents(rows?.planned ?? '0'),
        assignedCount: safeSumCents(rows?.assignedCount ?? '0'),
        inProgressCount: safeSumCents(rows?.inProgress ?? '0'),
        partiallyCompletedCount: safeSumCents(rows?.partial ?? '0'),
        requiresAttentionCount: safeSumCents(rows?.attention ?? '0'),
        awaitingReviewCount: safeSumCents(rows?.review ?? '0'),
        completedCount: safeSumCents(rows?.completed ?? '0'),
        openIssueCount: safeSumCents(rows?.issues ?? '0'),
        returnVisitRequiredCount: safeSumCents(rows?.returns ?? '0'),
        orderTotalCents: total,
        paidCents,
        balanceCents: total - paidCents,
        currency: 'EUR',
      };
    });
  }
}

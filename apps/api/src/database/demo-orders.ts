import type { DataSource } from 'typeorm';
import type { PaymentMethod, ServiceType } from '@furniture-delivery/contracts';
import type { AppConfig } from '../config/environment';
import { User } from '../identity/user.entity';
import { Order } from '../orders/order.entity';
import { OrderItem } from '../orders/order-item.entity';
import { Payment } from '../orders/payment.entity';
import { ActivityLog } from '../orders/activity-log.entity';
import { paymentFingerprint } from '../orders/order-finance';
import { assertSeedAllowed } from './demo-crews';

export const demoOrderKeys = Array.from(
  { length: 10 },
  (_, index) => `m3-demo-order-${String(index + 1).padStart(2, '0')}`,
);

/** Only a newly inserted order owns the right to initialise its whole demo aggregate. */
export async function seedOrders(
  dataSource: DataSource,
  nodeEnv: AppConfig['nodeEnv'],
): Promise<void> {
  assertSeedAllowed(nodeEnv);
  const actor = await dataSource.getRepository(User).findOneBy({ username: 'demo.dispatcher' });
  if (!actor) throw new Error('Seed identity before demo orders.');
  for (const [index, seedKey] of demoOrderKeys.entries()) {
    await dataSource.transaction('READ COMMITTED', async (manager) => {
      const category = index % 4;
      const serviceType: ServiceType = index % 2 === 0 ? 'DELIVERY_ONLY' : 'DELIVERY_AND_ASSEMBLY';
      const orderTotalCents = [100000, 150000, 65050, 0][category]!;
      const insert = await manager
        .createQueryBuilder()
        .insert()
        .into(Order)
        .values({
          seedKey,
          customerName: `Fictional Customer ${index + 1}`,
          contactName: null,
          phoneNumbers: ['+39 000 0000000'],
          email: `customer${index + 1}@example.invalid`,
          address: `Via Dimostrativa ${index + 1}`,
          city: ['Roma', 'Milano', 'Torino', 'Napoli'][category]!,
          country: 'Italy',
          postalCode: null,
          serviceType,
          workDescription:
            serviceType === 'DELIVERY_ONLY'
              ? 'Deliver demonstration furniture.'
              : 'Deliver and assemble demonstration furniture.',
          estimatedDurationMinutes: serviceType === 'DELIVERY_ONLY' ? 60 : 120,
          floor: null,
          hasElevator: null,
          easyAccess: null,
          parkingAvailable: null,
          accessRestrictions: '',
          accessNotes: 'Access details to be confirmed with the fictional customer.',
          internalNotes: 'Fictional demonstration order; no real customer data.',
          crewNotes: '',
          orderTotalCents,
          currency: 'EUR',
          version: 1,
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .onConflict('("seed_key") DO NOTHING')
        .returning(['id'])
        .execute();
      const inserted = insert.raw as { id: string }[];
      if (inserted.length === 0) return;
      const id = inserted[0]!.id;
      const order = await manager
        .getRepository(Order)
        .findOneOrFail({ where: { id }, lock: { mode: 'pessimistic_write' } });
      await manager.insert(ActivityLog, {
        orderId: id,
        actorId: actor.id,
        action: 'ORDER_CREATED',
        targetId: id,
        reason: null,
        changes: { source: 'demo-seed' },
      });
      for (const [sortOrder, description] of [
        'Demonstration table',
        'Demonstration chair',
      ].entries()) {
        const item = await manager.getRepository(OrderItem).save({
          orderId: id,
          description,
          quantity: sortOrder === 0 ? 1 : 4,
          configuration: 'Demo finish',
          ambient: 'Living room',
          notes: '',
          requiresAssembly: serviceType === 'DELIVERY_AND_ASSEMBLY',
          sortOrder,
          active: true,
        });
        await manager.insert(ActivityLog, {
          orderId: id,
          actorId: actor.id,
          action: 'ITEM_ADDED',
          targetId: item.id,
          reason: null,
          changes: { source: 'demo-seed' },
        });
      }
      const amounts =
        category === 1
          ? [20000, 30000]
          : category === 2
            ? [orderTotalCents]
            : index === 0
              ? [2500]
              : [];
      for (const [paymentIndex, amountCents] of amounts.entries()) {
        const input = {
          amountCents,
          paidOn: '2026-10-25',
          method: (paymentIndex === 0 ? 'BANK_TRANSFER' : 'CASH') as PaymentMethod,
          note: 'Fictional manual payment.',
        };
        const voided = index === 0;
        const payment = await manager.getRepository(Payment).save({
          ...input,
          orderId: id,
          idempotencyKey: `${seedKey}-payment-${paymentIndex + 1}`,
          fingerprint: paymentFingerprint(input),
          status: voided ? 'VOIDED' : 'RECORDED',
          createdBy: actor.id,
          voidedBy: voided ? actor.id : null,
          voidedAt: voided ? new Date() : null,
          voidReason: voided ? 'Demonstration correction of an erroneous journal entry.' : null,
        });
        await manager.insert(ActivityLog, {
          orderId: id,
          actorId: actor.id,
          action: 'PAYMENT_RECORDED',
          targetId: payment.id,
          reason: null,
          changes: { amountCents, source: 'demo-seed' },
        });
        order.version += 1;
        if (voided) {
          await manager.insert(ActivityLog, {
            orderId: id,
            actorId: actor.id,
            action: 'PAYMENT_VOIDED',
            targetId: payment.id,
            reason: payment.voidReason,
            changes: { amountCents, source: 'demo-seed' },
          });
          order.version += 1;
        }
      }
      await manager.save(Order, order);
    });
  }
}

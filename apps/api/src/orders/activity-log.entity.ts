import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { ActivityAction } from '@furniture-delivery/contracts';

@Entity({ name: 'activity_log' })
@Index('ix_activity_log_order_id', ['orderId', 'createdAt', 'id'])
@Check(
  'ck_activity_log_action',
  "\"action\" IN ('ORDER_CREATED', 'ORDER_UPDATED', 'ITEM_ADDED', 'ITEM_UPDATED', 'ITEM_REMOVED', 'PAYMENT_RECORDED', 'PAYMENT_VOIDED', 'APPOINTMENT_CREATED', 'APPOINTMENT_UPDATED', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELLED', 'CONFIRMATION_RESET', 'EXECUTION_DEPARTED', 'EXECUTION_ARRIVED', 'EXECUTION_STARTED', 'EXECUTION_FINISHED', 'TASK_RESULT_CHANGED', 'ITEM_FULFILLMENT', 'RETURN_VISIT_REQUESTED', 'EXECUTION_NOTE_ADDED', 'ISSUE_CREATED', 'ISSUE_RESOLVED', 'ISSUE_REOPENED', 'ISSUE_NOTE_ADDED', 'ATTACHMENT_UPLOADED', 'ATTACHMENT_WITHDRAWN', 'ESTIMATE_SET', 'APPOINTMENT_RESCHEDULED', 'RETURN_VISIT_PLANNED', 'RETURN_VISIT_RESOLVED', 'RETURN_VISIT_REOPENED', 'ACCEPTANCE_PREPARED', 'ACCEPTANCE_SIGNED', 'ACCEPTANCE_ABSENT', 'EXCEPTION_REVIEWED', 'ACCEPTANCE_INVALIDATED', 'ORDER_COMPLETED', 'ORDER_REOPENED')",
)
export class ActivityLog {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_activity_log' })
  id!: string;
  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;
  @Column({ name: 'actor_id', type: 'uuid' })
  actorId!: string;
  @Column({ type: 'varchar', length: 24 })
  action!: ActivityAction;
  @Column({ name: 'target_id', type: 'uuid' })
  targetId!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ type: 'varchar', length: 1000, nullable: true })
  reason!: string | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  changes!: Record<string, unknown>;
}

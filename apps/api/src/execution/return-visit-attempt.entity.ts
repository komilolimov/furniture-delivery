import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { ReturnAttemptScope } from '@furniture-delivery/contracts';

@Entity({ name: 'return_visit_attempt' })
@Unique('uq_return_attempt_appointment', ['appointmentId'])
@Index('uq_return_attempt_current', ['requestId'], { unique: true, where: '"current" = true' })
@Index('ix_return_attempt_request', ['requestId', 'createdAt', 'id'])
export class ReturnVisitAttempt {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
  @Column({ name: 'request_id', type: 'uuid' }) requestId!: string;
  @Column({ name: 'appointment_id', type: 'uuid' }) appointmentId!: string;
  @Column({ type: 'boolean', default: true }) current!: boolean;
  @Column({ name: 'closed_outcome', type: 'varchar', length: 16, nullable: true })
  closedOutcome!: 'CANCELLED' | 'FAILED' | 'RESOLVED' | null;
  @Column({ type: 'jsonb', update: false }) scope!: ReturnAttemptScope;
  @Column({ name: 'return_requested', type: 'boolean', default: false }) returnRequested!: boolean;
  @Column({ name: 'created_by', type: 'uuid' }) createdBy!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true }) closedAt!: Date | null;
  @Column({ name: 'closed_by', type: 'uuid', nullable: true }) closedBy!: string | null;
  @Column({ name: 'close_reason', type: 'varchar', length: 4000, nullable: true })
  closeReason!: string | null;
}

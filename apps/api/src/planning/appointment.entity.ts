import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { AppointmentStatus, ConfirmationStatus } from '@furniture-delivery/contracts';

@Entity({ name: 'appointment' })
@Unique('uq_appointment_order_key', ['orderId', 'idempotencyKey'])
@Index('ix_appointment_order_id', ['orderId'])
@Index('ix_appointment_range', ['plannedStartAt', 'plannedEndAt'])
export class Appointment {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_appointment' }) id!: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
  @Column({ name: 'planned_start_at', type: 'timestamptz' }) plannedStartAt!: Date;
  @Column({ name: 'planned_end_at', type: 'timestamptz' }) plannedEndAt!: Date;
  @Column({ name: 'duration_minutes', type: 'integer' }) durationMinutes!: number;
  @Column({ type: 'varchar', length: 16, default: 'SCHEDULED' }) status!: AppointmentStatus;
  @Column({
    name: 'confirmation_status',
    type: 'varchar',
    length: 24,
    default: 'NEEDS_CONFIRMATION',
  })
  confirmationStatus!: ConfirmationStatus;
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true }) confirmedAt!: Date | null;
  @Column({ name: 'confirmed_by', type: 'uuid', nullable: true }) confirmedBy!: string | null;
  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true }) cancelledAt!: Date | null;
  @Column({ name: 'cancelled_by', type: 'uuid', nullable: true }) cancelledBy!: string | null;
  @Column({ name: 'cancel_reason', type: 'varchar', length: 1000, nullable: true }) cancelReason!:
    | string
    | null;
  @Column({ type: 'varchar', length: 4000, default: '' }) notes!: string;
  @Column({ type: 'integer', default: 1 }) version!: number;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 100, select: false })
  idempotencyKey!: string;
  @Column({ type: 'varchar', length: 64, select: false }) fingerprint!: string;
  @Column({ name: 'created_by', type: 'uuid' }) createdBy!: string;
  @Column({ name: 'updated_by', type: 'uuid' }) updatedBy!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

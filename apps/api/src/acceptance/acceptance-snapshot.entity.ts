import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { AcceptanceSnapshotPayload } from '@furniture-delivery/contracts';

@Entity({ name: 'acceptance_snapshot' })
@Unique('uq_acceptance_snapshot_revision', ['appointmentId', 'version'])
@Index('uq_acceptance_snapshot_current', ['appointmentId'], {
  unique: true,
  where: '"invalidated_at" IS NULL',
})
@Index('ix_acceptance_snapshot_order', ['orderId', 'createdAt', 'id'])
export class AcceptanceSnapshot {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'order_id', type: 'uuid', update: false }) orderId!: string;
  @Column({ name: 'appointment_id', type: 'uuid', update: false }) appointmentId!: string;
  @Column({ type: 'integer', update: false }) version!: number;
  @Column({ type: 'jsonb', update: false }) payload!: AcceptanceSnapshotPayload;
  @Column({ type: 'text', select: false, update: false }) canonical!: string;
  @Column({ type: 'varchar', length: 64, update: false }) hash!: string;
  @Column({ name: 'created_by', type: 'uuid', update: false }) createdBy!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', update: false }) createdAt!: Date;
  @Column({ name: 'invalidated_at', type: 'timestamptz', nullable: true })
  invalidatedAt!: Date | null;
  @Column({ name: 'invalidated_by', type: 'uuid', nullable: true }) invalidatedBy!: string | null;
  @Column({ name: 'invalidation_reason', type: 'varchar', length: 4000, nullable: true })
  invalidationReason!: string | null;
}

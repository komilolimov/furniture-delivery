import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { AcceptanceSignerKind } from '@furniture-delivery/contracts';

@Entity({ name: 'acceptance_slot' })
@Unique('uq_acceptance_slot_assignment', ['snapshotId', 'assignmentId'])
@Index('uq_acceptance_customer_slot', ['snapshotId'], {
  unique: true,
  where: '"kind" = \'CUSTOMER\'',
})
export class AcceptanceSlot {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'snapshot_id', type: 'uuid', update: false }) snapshotId!: string;
  @Column({ name: 'order_id', type: 'uuid', update: false }) orderId!: string;
  @Column({ name: 'appointment_id', type: 'uuid', update: false }) appointmentId!: string;
  @Column({ type: 'varchar', length: 16, update: false }) kind!: AcceptanceSignerKind;
  @Column({ name: 'assignment_id', type: 'uuid', nullable: true, update: false }) assignmentId!:
    | string
    | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', update: false }) createdAt!: Date;
}

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { EvidenceVisibility } from '@furniture-delivery/contracts';
@Entity({ name: 'execution_note' })
@Index('ix_execution_note_order', ['orderId', 'createdAt', 'id'])
export class ExecutionNote {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
  @Column({ name: 'appointment_id', type: 'uuid', nullable: true }) appointmentId!: string | null;
  @Column({ name: 'assignment_id', type: 'uuid', nullable: true }) assignmentId!: string | null;
  @Column({ name: 'item_id', type: 'uuid', nullable: true }) itemId!: string | null;
  @Column({ type: 'varchar', length: 24 }) visibility!: EvidenceVisibility;
  @Column({ type: 'varchar', length: 4000 }) text!: string;
  @Column({ name: 'author_id', type: 'uuid' }) authorId!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

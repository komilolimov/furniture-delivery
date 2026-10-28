import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { ReturnRequestStatus } from '@furniture-delivery/contracts';

@Entity({ name: 'return_visit_request' })
@Unique('uq_return_visit_assignment', ['assignmentId'])
export class ReturnVisitRequest {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
  @Column({ name: 'appointment_id', type: 'uuid' }) appointmentId!: string;
  @Column({ name: 'assignment_id', type: 'uuid' }) assignmentId!: string;
  @Column({ name: 'finish_report_id', type: 'uuid' }) finishReportId!: string;
  @Column({ type: 'varchar', length: 16, default: 'OPEN' }) status!: ReturnRequestStatus;
  @Column({ type: 'integer', default: 1 }) version!: number;
  @Column({ type: 'varchar', length: 4000 }) reason!: string;
  @Column({ name: 'remaining_work', type: 'varchar', length: 4000 }) remainingWork!: string;
  @Column({ name: 'author_id', type: 'uuid' }) authorId!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true }) updatedBy!: string | null;
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true }) resolvedAt!: Date | null;
  @Column({ name: 'resolved_by', type: 'uuid', nullable: true }) resolvedBy!: string | null;
  @Column({ type: 'varchar', length: 4000, nullable: true }) resolution!: string | null;
}

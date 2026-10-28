import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  EvidenceVisibility,
  IssueStatus,
  IssueType,
  ReportedSource,
} from '@furniture-delivery/contracts';
@Entity({ name: 'evidence_issue' })
@Index('ix_issue_order_status', ['orderId', 'status'])
export class Issue {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
  @Column({ name: 'appointment_id', type: 'uuid', nullable: true }) appointmentId!: string | null;
  @Column({ name: 'assignment_id', type: 'uuid', nullable: true }) assignmentId!: string | null;
  @Column({ type: 'varchar', length: 24 }) visibility!: EvidenceVisibility;
  @Column({ type: 'varchar', length: 32 }) type!: IssueType;
  @Column({ type: 'varchar', length: 4000 }) description!: string;
  @Column({ name: 'reported_source', type: 'varchar', length: 16 }) reportedSource!: ReportedSource;
  @Column({ type: 'varchar', length: 16, default: 'OPEN' }) status!: IssueStatus;
  @Column({ type: 'integer', default: 1 }) version!: number;
  @Column({ name: 'author_id', type: 'uuid' }) authorId!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true }) resolvedAt!: Date | null;
  @Column({ name: 'resolved_by', type: 'uuid', nullable: true }) resolvedBy!: string | null;
  @Column({ type: 'varchar', length: 4000, nullable: true }) resolution!: string | null;
}

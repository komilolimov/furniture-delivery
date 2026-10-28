import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { CrewWorkItem, CrewWorkTask, TerminalOutcome } from '@furniture-delivery/contracts';

@Entity({ name: 'finish_report' })
@Unique('uq_finish_report_assignment', ['assignmentId'])
export class FinishReport {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
  @Column({ name: 'appointment_id', type: 'uuid' }) appointmentId!: string;
  @Column({ name: 'assignment_id', type: 'uuid' }) assignmentId!: string;
  @Column({ type: 'varchar', length: 32 }) outcome!: TerminalOutcome;
  @Column({ type: 'varchar', length: 4000 }) summary!: string;
  @Column({ type: 'varchar', length: 4000, nullable: true }) reason!: string | null;
  @Column({ name: 'remaining_work', type: 'varchar', length: 4000, nullable: true })
  remainingWork!: string | null;
  @Column({ name: 'quantity_scope', type: 'varchar', length: 32, default: 'ACCUMULATED_ORDER' })
  quantityScope!: 'ACCUMULATED_ORDER';
  @Column({ name: 'task_results', type: 'jsonb' }) taskResults!: CrewWorkTask[];
  @Column({ type: 'jsonb' }) quantities!: CrewWorkItem[];
  @Column({ name: 'known_issue_ids', type: 'uuid', array: true, default: () => "'{}'" })
  knownIssueIds!: string[];
  @Column({ name: 'attachment_ids', type: 'uuid', array: true, default: () => "'{}'" })
  attachmentIds!: string[];
  @Column({ name: 'author_id', type: 'uuid' }) authorId!: string;
  @Column({ name: 'actual_end_at', type: 'timestamptz' }) actualEndAt!: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { TaskSeverity, TaskResultStatus } from '@furniture-delivery/contracts';

@Entity({ name: 'task' })
@Index('ix_task_assignment', ['assignmentId'])
@Index('ix_task_source', ['sourceTaskId'])
@Index('ix_task_return_scope', ['returnScopeKey'])
@Index('uq_task_active_return_scope', ['assignmentId', 'returnScopeKey'], {
  unique: true,
  where: '"active" = true AND "return_scope_key" IS NOT NULL',
})
@Index('uq_task_active_template', ['assignmentId', 'templateId'], {
  unique: true,
  where: '"active" = true AND "template_id" IS NOT NULL',
})
export class Task {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_task' }) id!: string;
  @Column({ name: 'assignment_id', type: 'uuid' }) assignmentId!: string;
  @Column({ name: 'template_id', type: 'uuid', nullable: true }) templateId!: string | null;
  @Column({ name: 'source_task_id', type: 'uuid', nullable: true }) sourceTaskId!: string | null;
  @Column({ name: 'return_scope_key', type: 'uuid', nullable: true }) returnScopeKey!:
    | string
    | null;
  @Column({ type: 'varchar', length: 200 }) name!: string;
  @Column({ type: 'varchar', length: 4000, default: '' }) description!: string;
  @Column({ type: 'boolean' }) required!: boolean;
  @Column({ type: 'varchar', length: 8 }) severity!: TaskSeverity;
  @Column({ type: 'integer' }) priority!: number;
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @Column({ name: 'result_status', type: 'varchar', length: 16, default: 'PENDING' })
  resultStatus!: TaskResultStatus;
  @Column({ name: 'result_version', type: 'integer', default: 1 }) resultVersion!: number;
  @Column({ name: 'done_by', type: 'uuid', nullable: true }) doneBy!: string | null;
  @Column({ name: 'done_at', type: 'timestamptz', nullable: true }) doneAt!: Date | null;
  @Column({ name: 'result_reason', type: 'varchar', length: 4000, nullable: true }) resultReason!:
    | string
    | null;
}

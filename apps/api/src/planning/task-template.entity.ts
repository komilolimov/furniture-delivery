import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { TaskSeverity, TemplateApplicability } from '@furniture-delivery/contracts';

@Entity({ name: 'task_template' })
@Unique('uq_task_template_code', ['code'])
export class TaskTemplate {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_task_template' }) id!: string;
  @Column({ type: 'varchar', length: 64 }) code!: string;
  @Column({ type: 'varchar', length: 200 }) name!: string;
  @Column({ type: 'varchar', length: 4000, default: '' }) description!: string;
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @Column({ type: 'boolean', default: false }) required!: boolean;
  @Column({ type: 'varchar', length: 8, default: 'MEDIUM' }) severity!: TaskSeverity;
  @Column({ name: 'default_priority', type: 'integer', default: 0 }) defaultPriority!: number;
  @Column({ type: 'varchar', length: 32, default: 'ALL' }) applicability!: TemplateApplicability;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true }) updatedBy!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

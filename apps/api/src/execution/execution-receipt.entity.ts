import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity({ name: 'execution_receipt' })
@Unique('uq_execution_receipt_command', ['actorId', 'assignmentId', 'action', 'operationKey'])
export class ExecutionReceipt {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'actor_id', type: 'uuid' }) actorId!: string;
  @Column({ name: 'assignment_id', type: 'uuid' }) assignmentId!: string;
  @Column({ type: 'varchar', length: 64 }) action!: string;
  @Column({ name: 'operation_key', type: 'varchar', length: 100, select: false })
  operationKey!: string;
  @Column({ type: 'varchar', length: 64, select: false }) fingerprint!: string;
  @Column({ name: 'result_id', type: 'uuid', nullable: true }) resultId!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

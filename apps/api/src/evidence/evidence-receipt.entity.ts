import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
@Entity({ name: 'evidence_receipt' })
@Unique('uq_evidence_receipt_command', ['actorId', 'orderId', 'action', 'operationKey'])
export class EvidenceReceipt {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'actor_id', type: 'uuid' }) actorId!: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
  @Column({ type: 'varchar', length: 64 }) action!: string;
  @Column({ name: 'operation_key', type: 'varchar', length: 100, select: false })
  operationKey!: string;
  @Column({ type: 'varchar', length: 64, select: false }) fingerprint!: string;
  @Column({ name: 'result_id', type: 'uuid', nullable: true }) resultId!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

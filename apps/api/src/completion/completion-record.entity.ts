import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { CompletionDecisionSnapshot } from '@furniture-delivery/contracts';

@Entity({ name: 'completion_record' })
@Unique('uq_completion_id_order', ['id', 'orderId'])
@Index('ix_completion_order', ['orderId', 'createdAt', 'id'])
export class CompletionRecord {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'order_id', type: 'uuid', update: false }) orderId!: string;
  @Column({ name: 'actor_id', type: 'uuid', update: false }) actorId!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', update: false }) createdAt!: Date;
  @Column({ type: 'varchar', length: 4000, update: false }) reason!: string;
  @Column({ type: 'jsonb', update: false }) readiness!: CompletionDecisionSnapshot;
}

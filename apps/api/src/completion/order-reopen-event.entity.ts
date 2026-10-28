import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { OrderReopenSource } from '@furniture-delivery/contracts';

@Entity({ name: 'order_reopen_event' })
@Unique('uq_reopen_completion', ['completionId'])
@Index('ix_reopen_order', ['orderId', 'createdAt', 'id'])
export class OrderReopenEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'order_id', type: 'uuid', update: false }) orderId!: string;
  @Column({ name: 'completion_id', type: 'uuid', update: false }) completionId!: string;
  @Column({ name: 'actor_id', type: 'uuid', update: false }) actorId!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', update: false }) createdAt!: Date;
  @Column({ type: 'varchar', length: 4000, update: false }) reason!: string;
  @Column({ type: 'varchar', length: 16, update: false }) source!: OrderReopenSource;
  @Column({ name: 'source_id', type: 'uuid', nullable: true, update: false }) sourceId!:
    | string
    | null;
}

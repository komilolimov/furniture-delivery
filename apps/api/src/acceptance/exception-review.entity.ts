import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { ExceptionDecision } from '@furniture-delivery/contracts';

@Entity({ name: 'exception_review' })
@Unique('uq_exception_review_slot', ['slotId'])
@Unique('uq_exception_review_confirmation', ['confirmationId'])
export class ExceptionReview {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'slot_id', type: 'uuid', update: false }) slotId!: string;
  @Column({ name: 'confirmation_id', type: 'uuid', update: false }) confirmationId!: string;
  @Column({
    name: 'confirmation_method',
    type: 'varchar',
    length: 16,
    default: 'ABSENCE',
    update: false,
  })
  confirmationMethod!: 'ABSENCE';
  @Column({ type: 'varchar', length: 16, update: false }) decision!: ExceptionDecision;
  @Column({ type: 'varchar', length: 4000, update: false }) reason!: string;
  @Column({ name: 'reviewed_by_user_id', type: 'uuid', update: false }) reviewedByUserId!: string;
  @CreateDateColumn({ name: 'reviewed_at', type: 'timestamptz', update: false }) reviewedAt!: Date;
}

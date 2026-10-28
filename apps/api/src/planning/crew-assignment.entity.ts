import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AssignmentStatus, ExecutionStatus } from '@furniture-delivery/contracts';

@Entity({ name: 'crew_assignment' })
@Index('uq_crew_assignment_active', ['appointmentId', 'crewId'], {
  unique: true,
  where: '"status" = \'ASSIGNED\'',
})
@Index('ix_crew_assignment_crew', ['crewId', 'appointmentId'])
export class CrewAssignment {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_crew_assignment' }) id!: string;
  @Column({ name: 'appointment_id', type: 'uuid' }) appointmentId!: string;
  @Column({ name: 'crew_id', type: 'uuid' }) crewId!: string;
  @Column({ type: 'varchar', length: 16, default: 'ASSIGNED' }) status!: AssignmentStatus;
  @Column({ name: 'travel_buffer_minutes', type: 'integer' }) travelBufferMinutes!: number;
  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true }) cancelledAt!: Date | null;
  @Column({ name: 'cancelled_by', type: 'uuid', nullable: true }) cancelledBy!: string | null;
  @Column({ name: 'cancel_reason', type: 'varchar', length: 1000, nullable: true }) cancelReason!:
    | string
    | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @Column({ name: 'execution_status', type: 'varchar', length: 32, default: 'NOT_STARTED' })
  executionStatus!: ExecutionStatus;
  @Column({ name: 'execution_version', type: 'integer', default: 1 }) executionVersion!: number;
  @Column({ name: 'departed_at', type: 'timestamptz', nullable: true }) departedAt!: Date | null;
  @Column({ name: 'arrived_at', type: 'timestamptz', nullable: true }) arrivedAt!: Date | null;
  @Column({ name: 'actual_start_at', type: 'timestamptz', nullable: true })
  actualStartAt!: Date | null;
  @Column({ name: 'actual_end_at', type: 'timestamptz', nullable: true }) actualEndAt!: Date | null;
  @Column({ name: 'estimated_finish_at', type: 'timestamptz', nullable: true })
  estimatedFinishAt!: Date | null;
  @Column({ name: 'estimate_updated_at', type: 'timestamptz', nullable: true })
  estimateUpdatedAt!: Date | null;
  @Column({ name: 'estimate_updated_by', type: 'uuid', nullable: true })
  estimateUpdatedBy!: string | null;
  @Column({ name: 'estimate_reason', type: 'varchar', length: 4000, nullable: true })
  estimateReason!: string | null;
  @Column({ name: 'estimate_version', type: 'integer', default: 1 }) estimateVersion!: number;
}

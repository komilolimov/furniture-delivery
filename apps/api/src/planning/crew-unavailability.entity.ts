import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'crew_unavailability' })
@Index('ix_crew_unavailability_crew', ['crewId', 'startAt', 'endAt'])
export class CrewUnavailability {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_crew_unavailability' })
  id!: string;
  @Column({ name: 'crew_id', type: 'uuid' }) crewId!: string;
  @Column({ name: 'start_at', type: 'timestamptz' }) startAt!: Date;
  @Column({ name: 'end_at', type: 'timestamptz' }) endAt!: Date;
  @Column({ type: 'varchar', length: 1000 }) reason!: string;
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @Column({ name: 'created_by', type: 'uuid' }) createdBy!: string;
  @Column({ name: 'updated_by', type: 'uuid' }) updatedBy!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

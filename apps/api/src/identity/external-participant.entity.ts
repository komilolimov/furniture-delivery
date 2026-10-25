import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Crew } from '../crews/crew.entity';

@Entity({ name: 'external_participant' })
@Index('ix_external_participant_crew_id', ['crewId'])
@Check('ck_external_participant_name', 'length(btrim("name")) BETWEEN 1 AND 120')
@Check('ck_external_participant_specialty', 'length(btrim("specialty")) BETWEEN 1 AND 120')
export class ExternalParticipant {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_external_participant' })
  id!: string;

  @Column({ name: 'crew_id', type: 'uuid' })
  crewId!: string;

  @ManyToOne(() => Crew, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'crew_id', foreignKeyConstraintName: 'fk_external_participant_crew' })
  crew!: Crew;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 120 })
  specialty!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 254, nullable: true })
  email!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

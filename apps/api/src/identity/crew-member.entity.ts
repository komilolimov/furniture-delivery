import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Crew } from '../crews/crew.entity';
import { User } from './user.entity';

@Entity({ name: 'crew_member' })
@Unique('uq_crew_member_user_crew', ['userId', 'crewId'])
@Index('uq_crew_member_active_user', ['userId'], { unique: true, where: '"active" = true' })
@Index('ix_crew_member_crew_id', ['crewId'])
export class CrewMember {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_crew_member' })
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'crew_id', type: 'uuid' })
  crewId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'fk_crew_member_user' })
  user!: User;

  @ManyToOne(() => Crew, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'crew_id', foreignKeyConstraintName: 'fk_crew_member_crew' })
  crew!: Crew;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

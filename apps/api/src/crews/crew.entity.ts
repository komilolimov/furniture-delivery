import {
  Column,
  Check,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

export type WorkEnvironment = 'INDOOR' | 'OUTDOOR';

@Entity({ name: 'crew' })
@Unique('uq_crew_code', ['code'])
@Check('ck_crew_code', '"code" ~ \'^[A-Z][A-Z0-9_-]{2,31}$\'')
@Check('ck_crew_name', 'length(btrim("name")) > 0')
@Check('ck_crew_work_environment', "\"work_environment\" IN ('INDOOR', 'OUTDOOR')")
@Check('ck_crew_service_area', 'length(btrim("service_area")) BETWEEN 1 AND 2000')
export class Crew {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_crew' })
  id!: string;

  @Column({ type: 'varchar', length: 32, update: false })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'work_environment', type: 'varchar', length: 7 })
  workEnvironment!: WorkEnvironment;

  @Column({ name: 'service_area', type: 'text' })
  serviceArea!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

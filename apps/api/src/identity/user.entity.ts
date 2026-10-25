import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { UserRole } from '@furniture-delivery/contracts';

@Entity({ name: 'app_user' })
@Unique('uq_app_user_username', ['username'])
@Check('ck_app_user_username', '"username" ~ \'^[a-z][a-z0-9._-]{2,63}$\'')
@Check('ck_app_user_display_name', 'length(btrim("display_name")) BETWEEN 1 AND 120')
@Check('ck_app_user_role', "\"role\" IN ('ADMIN', 'DISPATCHER', 'CREW_MEMBER')")
export class User {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_app_user' })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  username!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  displayName!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 512, select: false })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 16 })
  role!: UserRole;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { ServiceType } from '@furniture-delivery/contracts';

@Entity({ name: 'delivery_order' })
@Unique('uq_delivery_order_number', ['number'])
@Unique('uq_delivery_order_seed_key', ['seedKey'])
@Index('ix_delivery_order_created_id', ['createdAt', 'id'])
@Check('ck_delivery_order_total', '"order_total_cents" BETWEEN 0 AND 2000000000')
@Check('ck_delivery_order_currency', '"currency" = \'EUR\'')
@Check('ck_delivery_order_version', '"version" > 0')
@Check(
  'ck_delivery_order_service',
  "\"service_type\" IN ('DELIVERY_ONLY', 'DELIVERY_AND_ASSEMBLY')",
)
export class Order {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_delivery_order' })
  id!: string;
  @Column({
    name: 'current_completion_id',
    type: 'uuid',
    nullable: true,
    select: false,
    insert: false,
  })
  currentCompletionId!: string | null;
  @Column({ type: 'varchar', length: 32 })
  number!: string;
  @Column({ name: 'seed_key', type: 'varchar', length: 64, nullable: true, select: false })
  seedKey!: string | null;
  @Column({ name: 'customer_name', type: 'varchar', length: 200 })
  customerName!: string;
  @Column({ name: 'contact_name', type: 'varchar', length: 200, nullable: true })
  contactName!: string | null;
  @Column({ name: 'phone_numbers', type: 'jsonb' })
  phoneNumbers!: string[];
  @Column({ type: 'varchar', length: 254, nullable: true })
  email!: string | null;
  @Column({ type: 'varchar', length: 500 })
  address!: string;
  @Column({ type: 'varchar', length: 120 })
  city!: string;
  @Column({ type: 'varchar', length: 120 })
  country!: string;
  @Column({ name: 'postal_code', type: 'varchar', length: 24, nullable: true })
  postalCode!: string | null;
  @Column({ name: 'service_type', type: 'varchar', length: 32 })
  serviceType!: ServiceType;
  @Column({ name: 'work_description', type: 'varchar', length: 4000 })
  workDescription!: string;
  @Column({ name: 'estimated_duration_minutes', type: 'integer' })
  estimatedDurationMinutes!: number;
  @Column({ type: 'varchar', length: 40, nullable: true })
  floor!: string | null;
  @Column({ name: 'has_elevator', type: 'boolean', nullable: true })
  hasElevator!: boolean | null;
  @Column({ name: 'easy_access', type: 'boolean', nullable: true })
  easyAccess!: boolean | null;
  @Column({ name: 'parking_available', type: 'boolean', nullable: true })
  parkingAvailable!: boolean | null;
  @Column({ name: 'access_restrictions', type: 'varchar', length: 4000, default: '' })
  accessRestrictions!: string;
  @Column({ name: 'access_notes', type: 'varchar', length: 4000, default: '' })
  accessNotes!: string;
  @Column({ name: 'internal_notes', type: 'varchar', length: 4000, default: '' })
  internalNotes!: string;
  @Column({ name: 'crew_notes', type: 'varchar', length: 4000, default: '' })
  crewNotes!: string;
  @Column({ name: 'order_total_cents', type: 'integer' })
  orderTotalCents!: number;
  @Column({ type: 'varchar', length: 3, default: 'EUR' })
  currency!: 'EUR';
  @Column({ type: 'integer', default: 1 })
  version!: number;
  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;
  @Column({ name: 'updated_by', type: 'uuid' })
  updatedBy!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

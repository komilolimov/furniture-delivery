import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { PaymentMethod, PaymentRecordStatus } from '@furniture-delivery/contracts';

@Entity({ name: 'payment' })
@Unique('uq_payment_order_key', ['orderId', 'idempotencyKey'])
@Index('ix_payment_order_id', ['orderId'])
@Check('ck_payment_amount', '"amount_cents" BETWEEN 1 AND 2000000000')
@Check('ck_payment_method', "\"method\" IN ('CASH', 'BANK_TRANSFER', 'CARD', 'OTHER')")
@Check('ck_payment_status', "\"status\" IN ('RECORDED', 'VOIDED')")
@Check('ck_payment_fingerprint', '"fingerprint" ~ \'^[a-f0-9]{64}$\'')
export class Payment {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_payment' })
  id!: string;
  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;
  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents!: number;
  @Column({ name: 'paid_on', type: 'date' })
  paidOn!: string;
  @Column({ type: 'varchar', length: 16 })
  method!: PaymentMethod;
  @Column({ type: 'varchar', length: 2000, nullable: true })
  note!: string | null;
  @Column({ type: 'varchar', length: 8, default: 'RECORDED' })
  status!: PaymentRecordStatus;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 100, select: false })
  idempotencyKey!: string;
  @Column({ type: 'varchar', length: 64, select: false })
  fingerprint!: string;
  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'voided_by', type: 'uuid', nullable: true })
  voidedBy!: string | null;
  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voidedAt!: Date | null;
  @Column({ name: 'void_reason', type: 'varchar', length: 1000, nullable: true })
  voidReason!: string | null;
}

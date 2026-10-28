import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { EvidenceVisibility, ProofType } from '@furniture-delivery/contracts';
@Entity({ name: 'attachment' })
@Index('ix_attachment_order', ['orderId', 'createdAt', 'id'])
export class Attachment {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
  @Column({ name: 'appointment_id', type: 'uuid', nullable: true }) appointmentId!: string | null;
  @Column({ name: 'assignment_id', type: 'uuid', nullable: true }) assignmentId!: string | null;
  @Column({ name: 'item_id', type: 'uuid', nullable: true }) itemId!: string | null;
  @Column({ type: 'varchar', length: 24 }) visibility!: EvidenceVisibility;
  @Column({ name: 'proof_type', type: 'varchar', length: 24, nullable: true })
  proofType!: ProofType | null;
  @Column({ type: 'varchar', length: 8 }) kind!: 'IMAGE' | 'PDF';
  @Column({ type: 'varchar', length: 8, default: 'READY' }) state!: 'READY';
  @Column({ name: 'display_name', type: 'varchar', length: 150 }) displayName!: string;
  @Column({ name: 'content_type', type: 'varchar', length: 32 }) contentType!:
    | 'image/webp'
    | 'application/pdf';
  @Column({ name: 'size_bytes', type: 'integer' }) sizeBytes!: number;
  @Column({ type: 'integer', nullable: true }) width!: number | null;
  @Column({ type: 'integer', nullable: true }) height!: number | null;
  @Column({ name: 'storage_key', type: 'varchar', length: 80, select: false }) storageKey!: string;
  @Column({ name: 'source_hash', type: 'varchar', length: 64, select: false }) sourceHash!: string;
  @Column({ name: 'author_id', type: 'uuid' }) authorId!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'withdrawn_at', type: 'timestamptz', nullable: true }) withdrawnAt!: Date | null;
  @Column({ name: 'withdrawn_by', type: 'uuid', nullable: true }) withdrawnBy!: string | null;
  @Column({ name: 'withdraw_reason', type: 'varchar', length: 4000, nullable: true })
  withdrawReason!: string | null;
}

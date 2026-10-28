import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { SignatureAbsenceKind } from '@furniture-delivery/contracts';

@Entity({ name: 'signature_confirmation' })
@Unique('uq_signature_slot', ['slotId'])
export class SignatureConfirmation {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'slot_id', type: 'uuid', update: false }) slotId!: string;
  @Column({ name: 'snapshot_id', type: 'uuid', update: false }) snapshotId!: string;
  @Column({ name: 'snapshot_hash', type: 'varchar', length: 64, update: false })
  snapshotHash!: string;
  @Column({ type: 'varchar', length: 16, update: false }) method!: 'SIGNED' | 'ABSENCE';
  @Column({ name: 'signer_name', type: 'varchar', length: 200, nullable: true, update: false })
  signerName!: string | null;
  @Column({ name: 'signer_relation', type: 'varchar', length: 200, nullable: true, update: false })
  signerRelation!: string | null;
  @Column({ name: 'captured_by_user_id', type: 'uuid', update: false }) capturedByUserId!: string;
  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz', update: false }) recordedAt!: Date;
  @Column({ type: 'bytea', nullable: true, select: false, update: false }) png!: Buffer | null;
  @Column({ name: 'image_digest', type: 'varchar', length: 64, nullable: true, update: false })
  imageDigest!: string | null;
  @Column({ type: 'integer', nullable: true, update: false }) width!: number | null;
  @Column({ type: 'integer', nullable: true, update: false }) height!: number | null;
  @Column({ name: 'size_bytes', type: 'integer', nullable: true, update: false }) sizeBytes!:
    | number
    | null;
  @Column({ name: 'absence_kind', type: 'varchar', length: 24, nullable: true, update: false })
  absenceKind!: SignatureAbsenceKind | null;
  @Column({ name: 'absence_reason', type: 'varchar', length: 4000, nullable: true, update: false })
  absenceReason!: string | null;
}

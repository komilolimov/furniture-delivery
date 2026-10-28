import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'order_item' })
@Index('ix_order_item_order_id', ['orderId'])
@Check('ck_order_item_quantity', '"quantity" BETWEEN 1 AND 10000')
@Check('ck_order_item_sort_order', '"sort_order" BETWEEN 0 AND 9999')
@Check('ck_order_item_description', 'length(btrim("description")) BETWEEN 1 AND 1000')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_order_item' })
  id!: string;
  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;
  @Column({ type: 'varchar', length: 1000 })
  description!: string;
  @Column({ type: 'integer' })
  quantity!: number;
  @Column({ type: 'varchar', length: 2000, default: '' })
  configuration!: string;
  @Column({ type: 'varchar', length: 120, default: '' })
  ambient!: string;
  @Column({ type: 'varchar', length: 2000, default: '' })
  notes!: string;
  @Column({ name: 'requires_assembly', type: 'boolean', default: false })
  requiresAssembly!: boolean;
  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;
  @Column({ type: 'boolean', default: true })
  active!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
  @Column({ name: 'delivered_quantity', type: 'integer', default: 0 }) deliveredQuantity!: number;
  @Column({ name: 'assembled_quantity', type: 'integer', default: 0 }) assembledQuantity!: number;
  @Column({ name: 'fulfillment_version', type: 'integer', default: 1 }) fulfillmentVersion!: number;
}

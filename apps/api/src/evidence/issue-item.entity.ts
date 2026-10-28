import { Column, Entity, PrimaryColumn } from 'typeorm';
@Entity({ name: 'issue_item' })
export class IssueItem {
  @PrimaryColumn({ name: 'issue_id', type: 'uuid' }) issueId!: string;
  @PrimaryColumn({ name: 'item_id', type: 'uuid' }) itemId!: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
}

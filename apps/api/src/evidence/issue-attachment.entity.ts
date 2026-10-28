import { Column, Entity, PrimaryColumn } from 'typeorm';
@Entity({ name: 'issue_attachment' })
export class IssueAttachment {
  @PrimaryColumn({ name: 'issue_id', type: 'uuid' }) issueId!: string;
  @PrimaryColumn({ name: 'attachment_id', type: 'uuid' }) attachmentId!: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
}

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
@Entity({ name: 'issue_event' })
@Index('ix_issue_event_issue', ['issueId', 'createdAt', 'id'])
export class IssueEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'issue_id', type: 'uuid' }) issueId!: string;
  @Column({ type: 'varchar', length: 16 }) kind!: 'CREATED' | 'NOTE' | 'RESOLVED' | 'REOPENED';
  @Column({ type: 'varchar', length: 4000 }) text!: string;
  @Column({ name: 'actor_id', type: 'uuid' }) actorId!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

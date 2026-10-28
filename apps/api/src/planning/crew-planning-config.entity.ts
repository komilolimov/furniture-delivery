import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { WeeklyWorkingWindow } from '@furniture-delivery/contracts';

@Entity({ name: 'crew_planning_config' })
export class CrewPlanningConfig {
  @PrimaryColumn({
    name: 'crew_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_crew_planning_config',
  })
  crewId!: string;
  @Column({ name: 'weekly_windows', type: 'jsonb' }) weeklyWindows!: WeeklyWorkingWindow[];
  @Column({ name: 'travel_buffer_minutes', type: 'integer', default: 30 })
  travelBufferMinutes!: number;
  @Column({ type: 'integer', default: 1 }) version!: number;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true }) updatedBy!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

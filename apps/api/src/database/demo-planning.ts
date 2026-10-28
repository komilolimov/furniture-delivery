import type { DataSource } from 'typeorm';
import type { AppConfig } from '../config/environment';
import { Crew } from '../crews/crew.entity';
import { CrewPlanningConfig } from '../planning/crew-planning-config.entity';
import { TaskTemplate } from '../planning/task-template.entity';
import { defaultWorkingWindows } from '../planning/planning-defaults';
import { assertSeedAllowed } from './demo-crews';

/** Editable MVP defaults; they are not externally confirmed company workflow rules. */
export const demoTaskTemplates = [
  {
    code: 'CHECK_PRODUCTS',
    name: 'Check products',
    description: 'Check that the expected furniture is present.',
    required: true,
    severity: 'HIGH',
    defaultPriority: 10,
    applicability: 'ALL',
  },
  {
    code: 'CHECK_QUANTITIES',
    name: 'Check quantities',
    description: 'Check the expected quantities.',
    required: true,
    severity: 'HIGH',
    defaultPriority: 20,
    applicability: 'ALL',
  },
  {
    code: 'CHECK_INTEGRITY',
    name: 'Check integrity',
    description: 'Check visible product integrity.',
    required: true,
    severity: 'HIGH',
    defaultPriority: 30,
    applicability: 'ALL',
  },
  {
    code: 'ASSEMBLE_PRODUCTS',
    name: 'Assemble products',
    description: 'Prepare the required furniture assembly work.',
    required: true,
    severity: 'HIGH',
    defaultPriority: 40,
    applicability: 'DELIVERY_AND_ASSEMBLY',
  },
  {
    code: 'CLEAR_AREA',
    name: 'Clear area',
    description: 'Leave the work area clear.',
    required: false,
    severity: 'MEDIUM',
    defaultPriority: 50,
    applicability: 'ALL',
  },
  {
    code: 'DISCARD_PACKAGES',
    name: 'Discard packages',
    description: 'Remove empty packaging as agreed.',
    required: false,
    severity: 'LOW',
    defaultPriority: 60,
    applicability: 'ALL',
  },
] satisfies Pick<
  TaskTemplate,
  'code' | 'name' | 'description' | 'required' | 'severity' | 'defaultPriority' | 'applicability'
>[];

/** Seed configuration only; never schedule any of the existing M3 orders. */
export async function seedPlanningDefaults(
  dataSource: DataSource,
  nodeEnv: AppConfig['nodeEnv'],
): Promise<void> {
  assertSeedAllowed(nodeEnv);
  const crews = await dataSource
    .getRepository(Crew)
    .find({ select: { id: true }, order: { id: 'ASC' } });
  for (const { id } of crews) {
    await dataSource.transaction('READ COMMITTED', async (manager) => {
      // Availability mutations and booking operations serialize on the same Crew resource.
      const crew = await manager
        .getRepository(Crew)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!crew) return;
      await manager
        .createQueryBuilder()
        .insert()
        .into(CrewPlanningConfig)
        .values({
          crewId: id,
          weeklyWindows: defaultWorkingWindows(),
          travelBufferMinutes: 30,
          version: 1,
          updatedBy: null,
        })
        .onConflict('("crew_id") DO NOTHING')
        .execute();
    });
  }
  await dataSource.transaction('READ COMMITTED', async (manager) => {
    await manager
      .createQueryBuilder()
      .insert()
      .into(TaskTemplate)
      .values(
        demoTaskTemplates.map((template) => ({
          ...template,
          active: true,
          createdBy: null,
          updatedBy: null,
        })),
      )
      .onConflict('("code") DO NOTHING')
      .execute();
  });
}

import type { DataSource } from 'typeorm';
import type { AppConfig } from '../config/environment';
import { Crew } from '../crews/crew.entity';

export const demoCrews = [
  { code: 'DEMO-01', name: 'Aurora', workEnvironment: 'INDOOR', serviceArea: 'Demo North' },
  { code: 'DEMO-02', name: 'Birch', workEnvironment: 'OUTDOOR', serviceArea: 'Demo North' },
  { code: 'DEMO-03', name: 'Cedar', workEnvironment: 'INDOOR', serviceArea: 'Demo East' },
  { code: 'DEMO-04', name: 'Dawn', workEnvironment: 'OUTDOOR', serviceArea: 'Demo East' },
  { code: 'DEMO-05', name: 'Elm', workEnvironment: 'INDOOR', serviceArea: 'Demo South' },
  { code: 'DEMO-06', name: 'Fern', workEnvironment: 'OUTDOOR', serviceArea: 'Demo South' },
  { code: 'DEMO-07', name: 'Grove', workEnvironment: 'INDOOR', serviceArea: 'Demo West' },
  { code: 'DEMO-08', name: 'Hazel', workEnvironment: 'OUTDOOR', serviceArea: 'Demo West' },
  { code: 'DEMO-09', name: 'Iris', workEnvironment: 'INDOOR', serviceArea: 'Demo Central' },
  { code: 'DEMO-10', name: 'Juniper', workEnvironment: 'OUTDOOR', serviceArea: 'Demo Central' },
] satisfies Pick<Crew, 'code' | 'name' | 'workEnvironment' | 'serviceArea'>[];

export function assertSeedAllowed(nodeEnv: AppConfig['nodeEnv']): void {
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error('Demo seed is allowed only in development or test.');
  }
}

export async function seedCrews(
  dataSource: DataSource,
  nodeEnv: AppConfig['nodeEnv'],
): Promise<void> {
  assertSeedAllowed(nodeEnv);
  await dataSource.transaction(async (manager) => {
    // The stable unique code provides atomic idempotency, also for concurrent runs.
    // DO NOTHING preserves existing names, flags, timestamps and other user edits.
    await manager
      .createQueryBuilder()
      .insert()
      .into(Crew)
      .values(demoCrews)
      .onConflict('("code") DO NOTHING')
      .execute();
  });
}

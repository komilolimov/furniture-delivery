import { readConfig } from '../config/environment';
import { createDataSource } from './data-source';
import { assertSeedAllowed, seedCrews } from './demo-crews';
import { seedIdentity } from './demo-identity';

async function main(): Promise<void> {
  const config = readConfig();
  assertSeedAllowed(config.nodeEnv);
  const dataSource = createDataSource(config);
  try {
    await dataSource.initialize();
    await seedCrews(dataSource, config.nodeEnv);
    await seedIdentity(dataSource, config.nodeEnv, process.env.SEED_PASSWORD);
    console.info('Demo crews and accounts seeded; existing records preserved.');
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

void main().catch(() => {
  console.error(
    'Seed failed. Use development/test, set SEED_PASSWORD for missing accounts, check .env and apply migrations first.',
  );
  process.exitCode = 1;
});

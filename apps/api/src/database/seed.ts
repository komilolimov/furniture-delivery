import { readConfig } from '../config/environment';
import { createDataSource } from './data-source';
import { assertSeedAllowed, seedCrews } from './demo-crews';
import { seedIdentity } from './demo-identity';
import { seedOrders } from './demo-orders';
import { seedPlanningDefaults } from './demo-planning';

async function main(): Promise<void> {
  const config = readConfig();
  assertSeedAllowed(config.nodeEnv);
  const dataSource = createDataSource(config);
  try {
    await dataSource.initialize();
    await seedCrews(dataSource, config.nodeEnv);
    await seedIdentity(dataSource, config.nodeEnv, process.env.SEED_PASSWORD);
    await seedOrders(dataSource, config.nodeEnv);
    await seedPlanningDefaults(dataSource, config.nodeEnv);
    console.info(
      'Demo crews, accounts, orders and planning defaults seeded; existing records preserved.',
    );
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

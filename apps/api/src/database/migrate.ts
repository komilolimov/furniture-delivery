import { readConfig } from '../config/environment';
import { createDataSource } from './data-source';

async function main(): Promise<void> {
  const dataSource = createDataSource(readConfig());
  try {
    await dataSource.initialize();
    const migrations = await dataSource.runMigrations();
    console.info(`Applied ${migrations.length} migration(s).`);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

void main().catch(() => {
  console.error('Migration failed. Check .env, PostgreSQL connectivity and schema permissions.');
  process.exitCode = 1;
});

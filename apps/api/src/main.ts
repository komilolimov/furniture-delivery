import { createApplication } from './application';
import { readConfig } from './config/environment';

async function main(): Promise<void> {
  const config = readConfig();
  const app = await createApplication(config);
  app.enableShutdownHooks();
  await app.listen(config.apiPort, config.apiHost);
  console.info('Furniture Delivery API started. Health endpoint: /api/health');
}

void main().catch(() => {
  console.error('API startup failed. Check environment configuration and port availability.');
  process.exitCode = 1;
});

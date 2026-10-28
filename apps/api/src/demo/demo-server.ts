import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config as loadDotEnv } from 'dotenv';
import { createApplication } from '../application';
import { demoTargetConfig, loadDemoState, runConfig, verifyDemoSchema } from './demo-run-state';

async function main(): Promise<void> {
  const root = await realpath(resolve(__dirname, '../../../..')),
    runId = process.argv[2];
  if (!runId) throw new Error('An owned demo run ID is required.');
  loadDotEnv({ path: resolve(root, '.env'), quiet: true });
  const config = demoTargetConfig(process.env),
    state = await loadDemoState(root, runId, config);
  if (!['PREPARED', 'STOPPED', 'RUNNING'].includes(state.status))
    throw new Error('The demo run is not prepared.');
  await verifyDemoSchema(config, state);
  const app = await createApplication(runConfig(config, state, root));
  let closing = false;
  const close = () => {
    if (!closing) {
      closing = true;
      void app.close().then(() => {
        process.exitCode = 0;
      });
    }
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  await app.listen(3001, '127.0.0.1');
  console.info('Owned synthetic demo API started.');
}
void main().catch(() => {
  console.error('Owned demo API failed; inspect its private run state and target.');
  process.exitCode = 1;
});

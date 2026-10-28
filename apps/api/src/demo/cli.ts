import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config as loadDotEnv } from 'dotenv';
import { demoPaths, demoRunId, demoTargetConfig, newDemoRunId } from './demo-run-state';
import { prepareDemo } from './demo-prepare';
import { cleanupDemo, startDemo, stopDemo } from './demo-lifecycle';

export function demoArguments(args: string[]): {
  action: 'prepare' | 'start' | 'stop' | 'cleanup';
  runId: string;
  baseDate?: string;
} {
  const [action, ...options] = args;
  if (!['prepare', 'start', 'stop', 'cleanup'].includes(action ?? ''))
    throw new Error('Use demo prepare, start, stop or cleanup.');
  const flags = new Map<string, string>();
  for (let index = 0; index < options.length; index += 2) {
    const name = options[index],
      value = options[index + 1];
    if (
      !name ||
      !['--run', '--base-date'].includes(name) ||
      !value ||
      value.startsWith('--') ||
      flags.has(name)
    )
      throw new Error('Use distinct --run and optional --base-date values.');
    flags.set(name, value);
  }
  if (action !== 'prepare' && flags.has('--base-date'))
    throw new Error('Only a new prepare accepts --base-date.');
  if (action !== 'prepare' && !flags.has('--run'))
    throw new Error('Start, stop and cleanup require one explicit owned --run ID.');
  return {
    action: action as 'prepare' | 'start' | 'stop' | 'cleanup',
    runId: demoRunId(flags.get('--run') ?? newDemoRunId()),
    ...(flags.has('--base-date') ? { baseDate: flags.get('--base-date')! } : {}),
  };
}
async function main(): Promise<void> {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor! < 22 || (minor === 22 && patch! < 1))
    throw new Error('Use the pinned Node 24.22.1-compatible runtime.');
  const root = await realpath(resolve(__dirname, '../../../..'));
  loadDotEnv({ path: resolve(root, '.env'), quiet: true });
  const input = demoArguments(process.argv.slice(2)),
    config = demoTargetConfig(process.env);
  if (input.action === 'prepare') {
    const result = await prepareDemo(root, input.runId, config, input.baseDate),
      paths = demoPaths(root, input.runId);
    console.info(
      JSON.stringify({
        synthetic: true,
        runId: input.runId,
        repeated: result.repeated,
        counts: result.manifest.counts,
        manifestPath: paths.manifest,
        credentialsPath: paths.credentials,
      }),
    );
  }
  if (input.action === 'start') await startDemo(root, input.runId, config);
  if (input.action === 'stop') {
    await stopDemo(root, input.runId, config);
    console.info('Owned demo run stopped or already stopped.');
  }
  if (input.action === 'cleanup') {
    await cleanupDemo(root, input.runId, config);
    console.info('Only this verified owned demo schema, storage and build output were removed.');
  }
}
if (require.main === module)
  void main().catch((error: unknown) => {
    let message = error instanceof Error ? error.message : 'Demo command failed.';
    for (const key of ['DATABASE_PASSWORD', 'TEST_DATABASE_PASSWORD', 'SEED_PASSWORD']) {
      const secret = process.env[key];
      if (secret) message = message.split(secret).join('[REDACTED]');
    }
    console.error(message.replace(/fd_session=[^;\s]+/g, 'fd_session=[REDACTED]'));
    process.exitCode = 1;
  });

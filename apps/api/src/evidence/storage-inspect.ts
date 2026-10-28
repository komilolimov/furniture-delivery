import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readConfig } from '../config/environment';
import { createDataSource } from '../database/data-source';
import { Attachment } from './attachment.entity';
import { storageConfig } from './evidence-config';
export interface StorageInspection {
  dryRun: true;
  referencedCount: number;
  missingKeys: string[];
  unreferencedFinalKeys: string[];
  stagingCount: number;
  validatedCount: number;
  unsafeEntries: number;
}
/** Read-only inventory. An unreferenced file may still belong to an in-flight transaction. */
export async function inspectStorage(
  root: string,
  referenced: readonly string[],
): Promise<StorageInspection> {
  let unsafeEntries = 0;
  const list = async (folder: string) => {
    try {
      const entries = await readdir(join(root, folder));
      const files: string[] = [];
      for (const entry of entries) {
        const info = await lstat(join(root, folder, entry));
        if (info.isFile() && !info.isSymbolicLink()) files.push(entry);
        else unsafeEntries++;
      }
      return files;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  };
  if ((await lstat(root).catch(() => null))?.isSymbolicLink())
    throw new Error('Inspection refuses a symbolic-link storage root.');
  for (const folder of ['staging', 'validated', 'final'])
    if ((await lstat(join(root, folder)).catch(() => null))?.isSymbolicLink())
      throw new Error('Inspection refuses a symbolic-link directory.');
  const [final, staging, validated] = await Promise.all([
    list('final'),
    list('staging'),
    list('validated'),
  ]);
  const known = new Set(referenced);
  return {
    dryRun: true,
    referencedCount: known.size,
    missingKeys: [...known].filter((key) => !final.includes(key)).sort(),
    unreferencedFinalKeys: final.filter((key) => !known.has(key)).sort(),
    stagingCount: staging.length,
    validatedCount: validated.length,
    unsafeEntries,
  };
}
async function main(): Promise<void> {
  if (process.argv.slice(2).some((argument) => argument !== '--dry-run'))
    throw new Error('Only --dry-run is supported. No files are removed.');
  const config = readConfig(),
    source = createDataSource(config);
  try {
    await source.initialize();
    const attachments = await source
      .getRepository(Attachment)
      .createQueryBuilder('file')
      .select('file.id')
      .addSelect('file.storageKey')
      .getMany();
    const result = await inspectStorage(
      storageConfig(config).root,
      attachments.map((file) => file.storageKey),
    );
    console.info(JSON.stringify(result, null, 2));
    console.info(
      'Read-only inspection. Unreferenced files may be in flight; no deletion was performed. Back up PostgreSQL and private storage together before any manual maintenance.',
    );
  } finally {
    if (source.isInitialized) await source.destroy();
  }
}
if (require.main === module)
  void main().catch(() => {
    console.error(
      'Storage inspection could not complete. Check local database and storage availability. No deletion was performed.',
    );
    process.exitCode = 1;
  });

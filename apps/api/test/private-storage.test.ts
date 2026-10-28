import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
}));
import { PrivateStorage } from '../src/evidence/private-storage';
import { AttachmentsDto } from '../src/evidence/attachments.dto';
import type { StagedUpload } from '../src/evidence/private-storage';
import { inspectStorage } from '../src/evidence/storage-inspect';
import { storageConfig } from '../src/evidence/evidence-config';
import type { StorageConfig } from '../src/evidence/evidence-config';
describe('private local image/PDF storage', () => {
  let root: string, storage: PrivateStorage;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fd-storage-unit-'));
    const config: StorageConfig = {
      root,
      imageMaxBytes: 10485760,
      pdfMaxBytes: 20971520,
      maxPixels: 40000000,
      orderMaxFiles: 100,
      orderMaxBytes: 262144000,
    };
    storage = new PrivateStorage(config);
    await storage.initialize();
    root = storage.config.root;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });
  async function staged(bytes: Buffer, name = 'fixture.png'): Promise<StagedUpload> {
    const path = join(await storage.stagingDirectory(), randomUUID());
    await writeFile(path, bytes);
    return { path, originalname: name, size: bytes.length };
  }
  const image = () =>
    sharp({ create: { width: 3, height: 2, channels: 3, background: '#394893' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
  it('canonicalizes a trusted tmp ancestor and normalizes orientation while stripping source metadata', async () => {
    const raw = await image(),
      file = await staged(raw, 'camera.jpeg'),
      sourceHash = await storage.hash(file),
      validated = await storage.validate(file, sourceHash, true);
    expect(validated.sourceHash).toBe(sourceHash);
    expect(validated.width).toBe(2);
    expect(validated.height).toBe(3);
    const metadata = await sharp(validated.path).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    await storage.promote(validated);
    const opened = await storage.content(validated.storageKey);
    expect(opened.size).toBe(validated.sizeBytes);
    await opened.handle.close();
    expect(await readdir(join(root, 'validated'))).toEqual([]);
  });
  it('rejects SVG, executable-like bytes and corrupt images despite harmless display names', async () => {
    for (const bytes of [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      Buffer.from('MZ invalid executable'),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]),
    ]) {
      const file = await staged(bytes);
      await expect(storage.validate(file, await storage.hash(file), false)).rejects.toThrow(
        'valid JPEG',
      );
    }
    expect(await readdir(join(root, 'validated'))).toEqual([]);
  });
  it('enforces raw byte and decoded pixel limits before publication', async () => {
    const file = await staged(await image());
    storage.config.imageMaxBytes = 16;
    await expect(storage.validate(file, await storage.hash(file), false)).rejects.toThrow(
      'image size',
    );
    storage.config.imageMaxBytes = 10485760;
    storage.config.maxPixels = 4;
    await expect(storage.validate(file, await storage.hash(file), false)).rejects.toThrow(
      'pixel limit',
    );
    expect(await readdir(join(root, 'final'))).toEqual([]);
  });
  it('permits bounded PDF attachment only for backoffice and verifies format markers', async () => {
    const pdf = await staged(Buffer.from('%PDF-1.7\nfixture\n%%EOF'), 'instructions.pdf');
    const valid = await storage.validate(pdf, await storage.hash(pdf), false);
    expect(valid.kind).toBe('PDF');
    expect(valid.contentType).toBe('application/pdf');
    await expect(storage.validate(pdf, await storage.hash(pdf), true)).rejects.toThrow(
      'images only',
    );
    const bad = await staged(Buffer.from('%PDF-1.7\ntruncated'));
    await expect(storage.validate(bad, await storage.hash(bad), false)).rejects.toThrow(
      'PDF format',
    );
  });
  it('rejects symlink files and arbitrary storage keys without deleting their targets', async () => {
    const outside = join(root, 'target');
    await writeFile(outside, 'preserve target');
    const link = join(root, 'staging', 'link');
    await symlink(outside, link);
    await expect(storage.hash({ path: link, originalname: 'x.png', size: 15 })).rejects.toThrow(
      'Invalid upload',
    );
    await storage.cleanup(link, 'staging');
    expect(await readFile(outside, 'utf8')).toBe('preserve target');
    expect(() => storage.finalPath('../target')).toThrow('Invalid attachment');
  });
  it('dry-run reports orphan/missing references and leaves every byte unchanged', async () => {
    const key = randomUUID() + '.webp';
    await writeFile(join(root, 'final', key), 'orphan');
    const missing = randomUUID() + '.pdf';
    const result = await inspectStorage(root, [missing]);
    expect(result.dryRun).toBe(true);
    expect(result.unreferencedFinalKeys).toEqual([key]);
    expect(result.missingKeys).toEqual([missing]);
    expect(await readFile(join(root, 'final', key), 'utf8')).toBe('orphan');
  });
  it('cleans its final hardlink if removal of the validated source fails', async () => {
    const file = await staged(await image());
    const validated = await storage.validate(file, await storage.hash(file), false);
    const unlinkOriginal = filesystem.unlink;
    vi.spyOn(filesystem, 'unlink').mockImplementation(async (path) => {
      if (String(path) === validated.path) throw new Error('fixture source cleanup failure');
      return unlinkOriginal(path);
    });
    await expect(storage.promote(validated)).rejects.toThrow('could not be stored');
    expect(await readdir(join(root, 'final'))).toEqual([]);
    expect(await readFile(validated.path)).not.toHaveLength(0);
  });
  it('refuses storage under public or build outputs', () => {
    expect(() =>
      storageConfig({
        nodeEnv: 'development',
        storage: { root: join(root, 'public', 'uploads') },
      } as never),
    ).toThrow('outside public');
  });
});

describe('attachment request boundary', () => {
  it('rejects repeated multipart enum arrays and NUL reasons while retaining normal multiline text', () => {
    expect(() =>
      AttachmentsDto.upload({ operationKey: 'fixture-key', proofType: ['DAMAGE'] }, true),
    ).toThrow('proofType');
    expect(() =>
      AttachmentsDto.withdraw({ operationKey: 'fixture-key', reason: 'bad\0text' }),
    ).toThrow('reason');
    expect(
      AttachmentsDto.withdraw({
        operationKey: 'fixture-key',
        reason: ' First line\n\tSecond line ',
      }),
    ).toEqual({ operationKey: 'fixture-key', reason: 'First line\n\tSecond line' });
  });
});

import { constants, createReadStream } from 'node:fs';
import { copyFile, link, lstat, mkdir, open, realpath, stat, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  BadRequestException,
  Inject,
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import sharp from 'sharp';
import { STORAGE_CONFIG } from './evidence-config';
import type { StorageConfig } from './evidence-config';
export function unsafeFilenameCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return code <= 31 || code === 127 || char === '/' || char === String.fromCharCode(92);
}
export interface StagedUpload {
  path: string;
  originalname: string;
  size: number;
}
export interface ValidatedUpload {
  path: string;
  storageKey: string;
  sourceHash: string;
  displayName: string;
  kind: 'IMAGE' | 'PDF';
  contentType: 'image/webp' | 'application/pdf';
  sizeBytes: number;
  width: number | null;
  height: number | null;
}
/** Bounded decode concurrency and queue; disk upload limits prevent whole raw files in memory. */
@Injectable()
export class PrivateStorage {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  private initialized?: Promise<void>;
  constructor(@Inject(STORAGE_CONFIG) readonly config: StorageConfig) {}
  async initialize(): Promise<void> {
    this.initialized ??= (async () => {
      await mkdir(this.config.root, { recursive: true, mode: 0o700 });
      if ((await lstat(this.config.root)).isSymbolicLink())
        throw new Error('Private storage must not be a symbolic link.');
      this.config.root = await realpath(this.config.root);
      for (const dir of ['staging', 'validated', 'final']) {
        const path = join(this.config.root, dir);
        await mkdir(path, { recursive: true, mode: 0o700 });
        if (!(await lstat(path)).isDirectory() || (await lstat(path)).isSymbolicLink())
          throw new Error('Invalid private storage directory.');
      }
    })();
    try {
      await this.initialized;
    } catch {
      this.initialized = undefined;
      throw new ServiceUnavailableException('Private file storage is unavailable.');
    }
  }
  async stagingDirectory(): Promise<string> {
    await this.initialize();
    return join(this.config.root, 'staging');
  }
  async hash(file: StagedUpload): Promise<string> {
    await this.assertOwned(file.path, 'staging');
    const hash = createHash('sha256');
    for await (const part of createReadStream(file.path)) hash.update(part);
    return hash.digest('hex');
  }
  displayName(value: string): string {
    return (
      Array.from(value.normalize('NFC'))
        .map((char) => (unsafeFilenameCharacter(char) ? '_' : char))
        .join('')
        .trim()
        .slice(0, 150) || 'attachment'
    );
  }
  private async assertOwned(
    path: string,
    folder: 'staging' | 'validated' | 'final',
  ): Promise<void> {
    await this.initialize();
    if (
      resolve(path) !== path ||
      !path.startsWith(join(this.config.root, folder) + '/') ||
      path.slice(join(this.config.root, folder).length + 1).includes('/') ||
      (await lstat(join(this.config.root, folder))).isSymbolicLink() ||
      (await lstat(path)).isSymbolicLink() ||
      !(await lstat(path)).isFile() ||
      (await realpath(path)) !== path
    )
      throw new BadRequestException('Invalid upload.');
  }
  async cleanup(
    path: string | undefined,
    folder: 'staging' | 'validated' | 'final',
  ): Promise<void> {
    if (!path) return;
    try {
      await this.assertOwned(path, folder);
      await unlink(path);
    } catch {
      /* Only this request's controlled path is eligible; missing files need no cleanup. */
    }
  }
  private async slot<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 2) {
      if (this.waiters.length >= 4)
        throw new ServiceUnavailableException('Image processing is busy. Retry shortly.');
      await new Promise<void>((done) => this.waiters.push(done));
    } else this.active++;
    try {
      return await work();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
  async validate(file: StagedUpload, sourceHash: string, crew: boolean): Promise<ValidatedUpload> {
    await this.assertOwned(file.path, 'staging');
    const actual = await stat(file.path);
    if (actual.size === 0 || actual.size !== file.size)
      throw new BadRequestException('The uploaded file is empty or incomplete.');
    if (actual.size > this.config.pdfMaxBytes)
      throw new PayloadTooLargeException('The file exceeds the upload size limit.');
    const source = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const header = Buffer.alloc(16);
    const tail = Buffer.alloc(Math.min(2048, actual.size));
    try {
      await source.read(header, 0, 16, 0);
      await source.read(tail, 0, tail.length, actual.size - tail.length);
    } finally {
      await source.close();
    }
    const displayName = this.displayName(file.originalname);
    if (header.subarray(0, 5).toString() === '%PDF-') {
      if (crew)
        throw new BadRequestException('Team evidence accepts JPEG, PNG or WebP images only.');
      if (!/^%PDF-[12]\.[0-9]/.test(header.toString()) || !tail.toString().includes('%%EOF'))
        throw new BadRequestException('The PDF format is invalid.');
      const storageKey = randomUUID() + '.pdf',
        path = join(this.config.root, 'validated', storageKey);
      try {
        await copyFile(file.path, path, constants.COPYFILE_EXCL);
      } catch {
        await this.cleanup(path, 'validated');
        throw new ServiceUnavailableException('The PDF could not be validated in storage.');
      }
      return {
        path,
        storageKey,
        sourceHash,
        displayName,
        kind: 'PDF',
        contentType: 'application/pdf',
        sizeBytes: actual.size,
        width: null,
        height: null,
      };
    }
    if (actual.size > this.config.imageMaxBytes)
      throw new PayloadTooLargeException('The image exceeds the image size limit.');
    return this.slot(async () => {
      const storageKey = randomUUID() + '.webp',
        path = join(this.config.root, 'validated', storageKey);
      try {
        const image = sharp(file.path, {
          limitInputPixels: this.config.maxPixels,
          failOn: 'warning',
          animated: false,
        });
        const metadata = await image.metadata();
        if (
          !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
          !metadata.width ||
          !metadata.height ||
          metadata.width * metadata.height > this.config.maxPixels ||
          (metadata.pages ?? 1) > 1
        )
          throw new Error('Unsupported image.');
        const output = await image.autoOrient().webp({ quality: 85 }).toFile(path);
        return {
          path,
          storageKey,
          sourceHash,
          displayName,
          kind: 'IMAGE',
          contentType: 'image/webp',
          sizeBytes: output.size,
          width: output.width,
          height: output.height,
        };
      } catch {
        await this.cleanup(path, 'validated');
        throw new BadRequestException(
          'Use a valid JPEG, PNG or WebP image within the pixel limit. HEIC is not supported.',
        );
      }
    });
  }
  async promote(file: ValidatedUpload): Promise<void> {
    await this.assertOwned(file.path, 'validated');
    const target = this.finalPath(file.storageKey);
    let linked = false;
    try {
      await link(file.path, target);
      linked = true;
      await unlink(file.path);
    } catch {
      if (linked) await this.cleanup(target, 'final');
      throw new ServiceUnavailableException('The attachment could not be stored.');
    }
  }
  finalPath(key: string): string {
    if (!/^[a-f0-9-]{36}\.(webp|pdf)$/.test(key))
      throw new BadRequestException('Invalid attachment.');
    return join(this.config.root, 'final', key);
  }
  async content(key: string): Promise<{ handle: FileHandle; size: number }> {
    const path = this.finalPath(key);
    await this.assertOwned(path, 'final');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    return { handle, size: (await handle.stat()).size };
  }
}

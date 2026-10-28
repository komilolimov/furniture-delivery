import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import type { EvidenceLimits } from '@furniture-delivery/contracts';
import type { AppConfig } from '../config/environment';
export const EVIDENCE_LIMITS = Symbol('EVIDENCE_LIMITS');
export const STORAGE_CONFIG = Symbol('STORAGE_CONFIG');
export interface StorageConfig extends EvidenceLimits {
  root: string;
}
export function storageConfig(config: AppConfig): StorageConfig {
  const root = resolve(
    config.storage?.root ??
      (config.nodeEnv === 'test'
        ? resolve(tmpdir(), 'furniture-delivery-tests', randomUUID())
        : resolve(__dirname, '../../../../uploads')),
  );
  if (
    root
      .split('/')
      .some((part) => ['public', '.next', 'dist', 'build', 'node_modules'].includes(part))
  )
    throw new Error('Private storage must be outside public and build directories.');
  return {
    root,
    imageMaxBytes: config.storage?.imageMaxBytes ?? 10485760,
    pdfMaxBytes: config.storage?.pdfMaxBytes ?? 20971520,
    maxPixels: config.storage?.maxPixels ?? 40000000,
    orderMaxFiles: config.storage?.orderMaxFiles ?? 100,
    orderMaxBytes: config.storage?.orderMaxBytes ?? 262144000,
  };
}

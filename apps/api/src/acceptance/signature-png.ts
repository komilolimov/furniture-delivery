import { createHash } from 'node:crypto';
import {
  BadRequestException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import sharp from 'sharp';

export const SIGNATURE_MAX_BYTES = 256 * 1024;
export const SIGNATURE_MAX_PIXELS = 2048 * 1024;
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let decoding = 0;
export interface DecodedSignature {
  png: Buffer;
  digest: string;
  sourceDigest: string;
  width: number;
  height: number;
  sizeBytes: number;
}
function plainPng(input: Buffer): boolean {
  if (input.length < 20 || !input.subarray(0, 8).equals(PNG_MAGIC)) return false;
  let offset = 8;
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset),
      type = input.toString('ascii', offset + 4, offset + 8);
    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      length > input.length - offset - 12 ||
      ['acTL', 'fcTL', 'fdAT'].includes(type)
    )
      return false;
    offset += length + 12;
    if (type === 'IEND') return length === 0 && offset === input.length;
  }
  return false;
}
/** Bounds apply before decoding and before the atomic bytea insert. No disk/public storage is used. */
export async function decodeSignaturePng(input: Buffer): Promise<DecodedSignature> {
  if (input.length > SIGNATURE_MAX_BYTES)
    throw new PayloadTooLargeException('The signature exceeds the 256 KiB limit.');
  if (!plainPng(input))
    throw new BadRequestException('Choose a valid, non-animated PNG signature.');
  if (decoding >= 2)
    throw new ServiceUnavailableException('Signature processing is busy. Retry shortly.');
  decoding++;
  try {
    const image = sharp(input, {
      limitInputPixels: SIGNATURE_MAX_PIXELS,
      failOn: 'warning',
      animated: false,
      sequentialRead: true,
    }).timeout({ seconds: 5 });
    const metadata = await image.metadata();
    if (
      metadata.format !== 'png' ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 2048 ||
      metadata.height > 1024 ||
      metadata.width * metadata.height > SIGNATURE_MAX_PIXELS ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error('Invalid PNG dimensions.');
    const { data, info } = await image
      .ensureAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 4) throw new Error('Invalid decoded channels.');
    let first: string | null = null,
      variation = false;
    for (let offset = 0; offset < data.length; offset += 4) {
      const alpha = data[offset + 3]!;
      const rgb = [0, 1, 2]
        .map((channel) => Math.round((data[offset + channel]! * alpha + 255 * (255 - alpha)) / 255))
        .join(',');
      first ??= rgb;
      if (rgb !== first) {
        variation = true;
        break;
      }
    }
    if (!variation) throw new Error('Blank PNG.');
    const png = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
      limitInputPixels: SIGNATURE_MAX_PIXELS,
    })
      .timeout({ seconds: 5 })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    if (png.length > SIGNATURE_MAX_BYTES)
      throw new PayloadTooLargeException('The processed signature exceeds the 256 KiB limit.');
    return {
      png,
      digest: createHash('sha256').update(png).digest('hex'),
      sourceDigest: createHash('sha256').update(input).digest('hex'),
      width: info.width,
      height: info.height,
      sizeBytes: png.length,
    };
  } catch (error) {
    if (error instanceof PayloadTooLargeException) throw error;
    throw new BadRequestException(
      'The PNG must contain a visible, non-uniform signature within 2048 × 1024 pixels.',
    );
  } finally {
    decoding--;
  }
}

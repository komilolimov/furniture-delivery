import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { decodeSignaturePng } from '../src/acceptance/signature-png';
import { animatedSignaturePng, bytesHash, syntheticSignature } from './acceptance-fixture';

describe('M7 bounded real PNG decoding and re-encoding', () => {
  it('accepts synthetic visible strokes, removes metadata and computes server digests from actual bytes', async () => {
    const source = await sharp(await syntheticSignature())
      .withMetadata({ exif: { IFD0: { ImageDescription: 'Synthetic test metadata only' } } })
      .png()
      .toBuffer();
    const decoded = await decodeSignaturePng(source),
      metadata = await sharp(decoded.png).metadata();
    expect([decoded.width, decoded.height]).toEqual([240, 80]);
    expect(decoded.sizeBytes).toBe(decoded.png.length);
    expect(decoded.sizeBytes).toBeLessThanOrEqual(256 * 1024);
    expect(decoded.sourceDigest).toBe(bytesHash(source));
    expect(decoded.digest).toBe(bytesHash(decoded.png));
    expect(decoded.digest).not.toBe(decoded.sourceDigest);
    expect(metadata.format).toBe('png');
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });

  it('rejects empty, invalid, truncated and disguised non-PNG content rather than trusting a filename or MIME label', async () => {
    const image = await syntheticSignature();
    for (const source of [
      Buffer.alloc(0),
      Buffer.from('not an image'),
      image.subarray(0, Math.floor(image.length / 2)),
      await sharp(image).jpeg().toBuffer(),
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><path d="M1 1L10 8" stroke="black"/></svg>',
      ),
      Buffer.from('<html>fixture</html>'),
    ])
      await expect(decodeSignaturePng(source)).rejects.toThrow();
  });

  it('rejects uniform and fully transparent canvases even when hidden RGB values contain a drawing', async () => {
    for (const background of ['#ffffff', '#000000', '#875b40']) {
      const source = await sharp({ create: { width: 240, height: 80, channels: 4, background } })
        .png()
        .toBuffer();
      await expect(decodeSignaturePng(source)).rejects.toThrow();
    }
    const hidden = randomBytes(240 * 80 * 4);
    for (let offset = 3; offset < hidden.length; offset += 4) hidden[offset] = 0;
    await expect(
      decodeSignaturePng(
        await sharp(hidden, { raw: { width: 240, height: 80, channels: 4 } })
          .png()
          .toBuffer(),
      ),
    ).rejects.toThrow();
  });

  it('enforces source bytes, width, height and pixel limits before retaining a signature', async () => {
    await expect(decodeSignaturePng(Buffer.alloc(256 * 1024 + 1))).rejects.toThrow();
    for (const [width, height] of [
      [2049, 20],
      [20, 1025],
      [2048, 1025],
    ]) {
      const source = await syntheticSignature(width, height);
      await expect(decodeSignaturePng(source)).rejects.toThrow();
    }
    const noisy = await sharp(randomBytes(300 * 300 * 4), {
      raw: { width: 300, height: 300, channels: 4 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(noisy.length).toBeGreaterThan(256 * 1024);
    await expect(decodeSignaturePng(noisy)).rejects.toThrow();
  });

  it('rejects an actual APNG container instead of silently taking the first frame', async () => {
    const animated = animatedSignaturePng(await syntheticSignature());
    expect(animated.includes(Buffer.from('acTL'))).toBe(true);
    expect(animated.includes(Buffer.from('fdAT'))).toBe(true);
    await expect(decodeSignaturePng(animated)).rejects.toThrow();
  });
});

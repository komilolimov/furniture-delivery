import sharp from 'sharp';
/** Only isolated opt-in demo fixtures call this function. This is not a real person's signature. */
export async function syntheticDemoPng(): Promise<Buffer> {
  const width = 240,
    height = 80,
    pixels = Buffer.alloc(width * height * 4, 255);
  for (let x = 12; x < width - 12; x++) {
    const y = Math.floor(height / 2 + Math.sin(x / 9) * 15);
    for (let dy = -2; dy <= 2; dy++) {
      const at = ((y + dy) * width + x) * 4;
      pixels[at] = 25;
      pixels[at + 1] = 38;
      pixels[at + 2] = 55;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

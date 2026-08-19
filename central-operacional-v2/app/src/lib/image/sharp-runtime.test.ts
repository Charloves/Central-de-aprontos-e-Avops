import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

describe('sharp runtime', () => {
  it('carrega o binario nativo no Windows e processa imagem em memoria', async () => {
    expect(sharp.versions.sharp).toBe('0.35.3');

    const input = await sharp({
      create: {
        width: 12,
        height: 8,
        channels: 4,
        background: { r: 10, g: 120, b: 220, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const output = await sharp(input).resize(6, 4).webp().toBuffer();
    const metadata = await sharp(output).metadata();

    expect(output.length).toBeGreaterThan(0);
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(6);
    expect(metadata.height).toBe(4);
  });
});

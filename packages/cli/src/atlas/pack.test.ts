import { describe, expect, it } from 'vitest';
import { packShelves } from './pack.js';

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('packShelves', () => {
  it('coloca tudo dentro da textura, sem sobreposição e com espaço entre as peças', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ w: 20 + ((i * 37) % 90), h: 15 + ((i * 53) % 70) }));
    const { width, height, places } = packShelves(items, 2);
    expect(Math.log2(width) % 1).toBe(0);
    const rects = places.map((p, i) => ({ ...p, w: items[i]!.w + 2, h: items[i]!.h + 2 }));
    rects.forEach((r) => {
      expect(r.x + r.w).toBeLessThanOrEqual(width);
      expect(r.y + r.h).toBeLessThanOrEqual(height);
    });
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
  });

  it('a largura cresce pra caber a peça mais larga', () => {
    expect(packShelves([{ w: 900, h: 10 }]).width).toBe(1024);
  });
});

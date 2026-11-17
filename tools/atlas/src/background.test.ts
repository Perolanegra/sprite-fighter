import { describe, expect, it } from 'vitest';
import { applyMask, foregroundMask } from './background.js';
import { fromAscii } from './testing.js';

describe('foregroundMask', () => {
  it('apaga só o branco ligado à borda; o branco cercado por contorno continua peça', () => {
    const img = fromAscii([
      '.......',
      '.#####.',
      '.#www#.',
      '.#####.',
      '.......',
    ]);
    const mask = foregroundMask(img);
    const at = (x: number, y: number) => mask[y * img.width + x];
    expect(at(0, 0)).toBe(0);
    expect(at(3, 2)).toBe(1); // camisa branca dentro do contorno
    expect(at(1, 1)).toBe(1);
  });

  it('não apaga o creme do sobretudo (saturação acima do limite)', () => {
    const img = fromAscii(['...', '.c.', '...']);
    const mask = foregroundMask(img, { minChannel: 240, maxSaturation: 14, edgeOpaqueBelow: 100 });
    expect(mask[4]).toBe(1);
  });
});

describe('applyMask', () => {
  it('zera o fundo, deixa o miolo opaco e desmistura a borda clara', () => {
    const img = fromAscii(['.....', '.###.', '.###.', '.###.', '.....']);
    // Borda antisserrilhada: um cinza claro (mistura de contorno e branco) no canto da peça.
    img.data.set([220, 220, 220, 255], (1 * 5 + 1) * 4);
    const out = applyMask(img, foregroundMask(img));
    expect(out.data[3]).toBe(0);
    expect(out.data[(2 * 5 + 2) * 4 + 3]).toBe(255);
    const edgeAlpha = out.data[(1 * 5 + 1) * 4 + 3]!;
    expect(edgeAlpha).toBeGreaterThan(0);
    expect(edgeAlpha).toBeLessThan(255);
    expect(out.data[(1 * 5 + 1) * 4]!).toBeLessThan(220); // cor sem o branco misturado
  });
});

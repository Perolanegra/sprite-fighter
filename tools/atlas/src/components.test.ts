import { describe, expect, it } from 'vitest';
import { connectedComponents, sortReadingOrder } from './components.js';

const maskOf = (rows: string[]) => Uint8Array.from(rows.join('').split('').map((c) => (c === '#' ? 1 : 0)));

describe('connectedComponents', () => {
  it('separa peças, junta diagonais (8 vizinhos) e descarta sujeira pequena', () => {
    const rows = [
      '##....#',
      '##.....',
      '..#...#',
      '.....##',
    ];
    const { labels, parts } = connectedComponents(maskOf(rows), 7, 4, 3);
    expect(parts.map((p) => p.area).sort()).toEqual([3, 5]);
    expect(labels[6]).toBe(0); // o pixel solto (área 1) saiu do mapa
    const big = parts.find((p) => p.area === 5)!;
    expect(big.bbox).toEqual({ x: 0, y: 0, w: 3, h: 3 });
  });

  it('mede quanto da caixa a peça ocupa', () => {
    const { parts } = connectedComponents(maskOf(['###', '###']), 3, 2, 1);
    expect(parts[0]!.fill).toBe(1);
  });
});

describe('sortReadingOrder', () => {
  it('lê por linhas (de cima pra baixo) e, em cada linha, da esquerda pra direita', () => {
    const box = (x: number, y: number, h = 10) => ({ bbox: { x, y, w: 10, h } });
    const a = box(50, 0, 40);
    const b = box(0, 5);
    const c = box(10, 60);
    expect(sortReadingOrder([c, a, b])).toEqual([b, a, c]);
  });
});

import { describe, expect, it } from 'vitest';
import { opaquePoints } from './geometry.js';
import { rectGeometry } from './testing.js';

describe('PartGeometry (PCA)', () => {
  it('acha o eixo comprido, comprimento e largura de uma peça em pé', () => {
    const g = rectGeometry(20, 100);
    expect(Math.abs(g.axis.y)).toBeCloseTo(1, 3);
    expect(g.length).toBeCloseTo(99, 0);
    expect(g.width).toBeCloseTo(19, 0);
  });

  it('as articulações ficam recuadas pra dentro das pontas, no meio da largura', () => {
    const g = rectGeometry(20, 100);
    const [a, b] = g.joints();
    const [top, bottom] = a.y < b.y ? [a, b] : [b, a];
    // recuo padrão = min(0.45 × largura, 0.25 × comprimento) = 8.55
    expect(top.y).toBeCloseTo(0.5 + 8.55, 0);
    expect(bottom.y).toBeCloseTo(99.5 - 8.55, 0);
    expect(top.x).toBeCloseTo(10, 0);
  });

  it('segue a peça girada', () => {
    const g = rectGeometry(10, 80, Math.PI / 4, 100, 100);
    expect(Math.abs(Math.abs(Math.atan2(g.axis.y, g.axis.x)) - (3 * Math.PI) / 4) < 0.02 || Math.abs(Math.atan2(g.axis.y, g.axis.x) + Math.PI / 4) < 0.02).toBe(true);
  });

  it('bboxPoint usa a fração da caixa', () => {
    const g = rectGeometry(40, 20);
    expect(g.bboxPoint(0.5, 1)).toEqual({ x: 20, y: 20 });
  });
});

describe('opaquePoints', () => {
  it('lista só os pixels acima do limiar, no centro do pixel', () => {
    expect(Array.from(opaquePoints([0, 255, 0, 200], 2, 2))).toEqual([1.5, 0.5, 1.5, 1.5]);
  });
});

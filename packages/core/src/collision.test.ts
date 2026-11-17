import { describe, expect, it } from 'vitest';
import { capsuleBoxHit, capsuleHit, circle, closestSegmentSegment } from './collision.js';

const P = (x: number, y: number) => ({ x, y });

describe('colisão', () => {
  it('segmentos cruzados: distância zero no cruzamento', () => {
    const [a, b] = closestSegmentSegment(P(-1, 0), P(1, 0), P(0, -1), P(0, 1));
    expect(a.x).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(0);
  });

  it('cápsulas paralelas: encostam só quando a distância < soma dos raios', () => {
    const a = { a: P(0, 0), b: P(100, 0), r: 10 };
    expect(capsuleHit(a, { a: P(0, 25), b: P(100, 25), r: 10 })).toBeNull();
    const hit = capsuleHit(a, { a: P(0, 15), b: P(100, 15), r: 10 });
    expect(hit?.depth).toBeCloseTo(5);
    expect(hit!.point.y).toBeGreaterThan(0);
    expect(hit!.point.y).toBeLessThan(15);
  });

  it('extremos: a ponta de uma encosta na ponta da outra', () => {
    const a = { a: P(0, 0), b: P(50, 0), r: 5 };
    expect(capsuleHit(a, { a: P(59, 0), b: P(100, 0), r: 5 })).not.toBeNull();
    expect(capsuleHit(a, { a: P(61, 0), b: P(100, 0), r: 5 })).toBeNull();
  });

  it('círculo × cápsula e círculo × círculo', () => {
    const cap = { a: P(0, 0), b: P(0, 100), r: 8 };
    expect(capsuleHit(circle(P(15, 50), 8), cap)).not.toBeNull();
    expect(capsuleHit(circle(P(17, 50), 8), cap)).toBeNull();
    expect(capsuleHit(circle(P(0, 0), 3), circle(P(5, 0), 3))?.depth).toBeCloseTo(1);
  });

  it('cápsula × caixa (porta)', () => {
    const box = { x: 100, y: 0, w: 20, h: 200 };
    expect(capsuleBoxHit({ a: P(0, 50), b: P(90, 50), r: 5 }, box)).toBeNull();
    expect(capsuleBoxHit({ a: P(0, 50), b: P(96, 50), r: 5 }, box)?.point.x).toBe(100);
    expect(capsuleBoxHit({ a: P(105, 50), b: P(110, 50), r: 2 }, box)).not.toBeNull(); // dentro
  });
});

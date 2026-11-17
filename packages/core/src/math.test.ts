import { describe, expect, it } from 'vitest';
import { apply, invert, multiply, rotation, translation, wrapAngle, deg2rad, scaling } from './math.js';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('Mat2D', () => {
  it('compõe na ordem certa (aplica a da direita primeiro)', () => {
    const m = multiply(translation(10, 0), rotation(deg2rad(90)));
    close(apply(m, { x: 1, y: 0 }), { x: 10, y: 1 });
  });

  it('a inversa desfaz a transformação', () => {
    const m = multiply(multiply(translation(5, -3), rotation(0.7)), scaling(2, -1));
    close(apply(invert(m), apply(m, { x: 3, y: 4 })), { x: 3, y: 4 });
  });

  it('wrapAngle normaliza em (-π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2);
  });
});

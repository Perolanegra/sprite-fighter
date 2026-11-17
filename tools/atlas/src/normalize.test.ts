import { describe, expect, it } from 'vitest';
import { headHeight, normalizedScale } from './normalize.js';

describe('normalização de escala entre poses', () => {
  const fly = { scale: 1.2, measure: { headTop: [100, 10], chin: [100, 160] } }; // cabeça 150 px → 180 no mundo

  it('mede a altura da cabeça (topo → queixo)', () => {
    expect(headHeight(fly)).toBe(150);
    expect(headHeight({ measure: { headTop: [0, 0], chin: [30, 40] } })).toBe(50);
    expect(headHeight({})).toBeNaN();
  });

  it('a cabeça de cada pose fica com o mesmo tamanho no mundo que a da fly', () => {
    const punch = { measure: { headTop: [400, 50], chin: [400, 250] } }; // cabeça 200 px
    const s = normalizedScale(fly, punch);
    expect(s).toBe(0.9);
    expect(headHeight(punch) * s).toBeCloseTo(headHeight(fly) * fly.scale, 6);
    expect(normalizedScale(fly, fly)).toBe(1.2);
  });

  it('erro claro sem measure', () => {
    expect(() => normalizedScale(fly, {})).toThrow(/measure/);
    expect(() => normalizedScale({}, fly)).toThrow(/base/);
  });
});

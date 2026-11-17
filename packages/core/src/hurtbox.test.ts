import { describe, expect, it } from 'vitest';
import { estimateHurtRadii } from './hurtbox.js';

describe('hurtboxes por pose', () => {
  it('raio = meia-largura da silhueta em volta do osso; tecido fica sem hurtbox', () => {
    // Faixa horizontal opaca de 30 px de altura (y 20..49) numa imagem 120×80.
    const w = 120, h = 80;
    const alpha = new Uint8ClampedArray(w * h);
    for (let y = 20; y < 50; y++) for (let x = 0; x < w; x++) alpha[y * w + x] = 255;
    const bone = { head: { x: 10, y: 35 }, tail: { x: 100, y: 35 } };
    const [body, cloth, outside] = estimateHurtRadii(alpha, w, h, [
      { ...bone, body: true },
      { ...bone, body: false },
      { head: { x: 10, y: 70 }, tail: { x: 100, y: 70 }, body: true },
    ]);
    expect(body).toBeCloseTo(14.5, 0);
    expect(cloth).toBe(0);
    expect(outside).toBe(0);
  });
});

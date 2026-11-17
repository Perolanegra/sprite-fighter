import { describe, expect, it } from 'vitest';
import { SIM_DT } from './loop.js';
import { Fall, MoveTo, knockback, type Body } from './motion.js';
import { Route } from './route.js';

const body = (x = 0, y = 0): Body => ({ position: { x, y }, velocity: { x: 0, y: 0 }, scale: 1 });
/** Integra como o Actor: velocidade × dt. */
function run(b: Body, m: { step(b: Body, dt: number): boolean }, steps: number): number {
  let i = 0;
  for (; i < steps; i++) {
    const done = m.step(b, SIM_DT);
    b.position.x += b.velocity.x * SIM_DT;
    b.position.y += b.velocity.y * SIM_DT;
    if (done) return i + 1;
  }
  return i;
}

describe('rota', () => {
  it('Bézier cúbica: começa e termina nos pontos; amostra por comprimento de arco', () => {
    const r = new Route('M 0 0 C 100 0 200 0 300 0');
    expect(r.point(0)).toEqual({ x: 0, y: 0 });
    expect(r.point(1).x).toBeCloseTo(300);
    expect(r.point(0.5).x).toBeCloseTo(150, 0); // velocidade constante, apesar dos pontos de controle
    expect(r.length).toBeCloseTo(300, 0);
  });
  it('L e Q; erro claro para comando relativo', () => {
    expect(new Route('M 0 0 L 10 0 L 10 10').length).toBeCloseTo(20);
    expect(new Route('M 0 0 Q 50 50 100 0').end).toEqual({ x: 100, y: 0 });
    expect(() => new Route('m 0 0 l 1 1')).toThrow(/absolutos/);
  });
});

describe('movimento dirigido', () => {
  it('moveTo termina exatamente no destino, no tempo pedido, e escala junto (profundidade)', () => {
    const b = body(10, 20);
    const steps = run(b, new MoveTo({ to: { x: 410, y: -80 }, duration: 0.5, ease: 'cubicOut', scaleTo: 0.5 }), 1000);
    expect(steps).toBe(60);
    expect(b.position.x).toBeCloseTo(410, 6);
    expect(b.position.y).toBeCloseTo(-80, 6);
    expect(b.scale).toBeCloseTo(0.5);
  });
  it('moveTo por rota percorre a curva', () => {
    const b = body(0, 0);
    run(b, new MoveTo({ route: 'M 0 0 C 0 100 300 100 300 0', duration: 1 }), 1000);
    expect(b.position.x).toBeCloseTo(300, 4);
    expect(b.position.y).toBeCloseTo(0, 4);
  });
  it('knockback decai com o arrasto e termina', () => {
    const b = body();
    const kb = knockback({ x: 1000, y: 0 }, 6);
    kb.step(b, SIM_DT);
    const v0 = b.velocity.x;
    run(b, kb, 30);
    expect(b.velocity.x).toBeLessThan(v0 * 0.3);
    expect(run(b, kb, 2000)).toBeLessThan(2000);
    expect(b.position.x).toBeGreaterThan(100);
  });
  it('queda acelera até a velocidade terminal', () => {
    const b = body();
    run(b, new Fall(0, 0, 2000, 500), 240);
    expect(b.velocity.y).toBe(500);
  });
});

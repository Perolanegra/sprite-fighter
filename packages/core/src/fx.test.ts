import { describe, expect, it } from 'vitest';
import { CameraRig, SHAKE_MAX, smoothNoise, union, type Rect } from './camera.js';
import { Effects } from './fx.js';
import { SIM_DT } from './loop.js';

const boxes = (...list: [string, Rect][]) => new Map(list);
/** A caixa está inteira dentro da vista (com a tremida máxima). */
function inside(cam: CameraRig, b: Rect): boolean {
  const v = cam.view(1);
  const hw = cam.width / 2 / v.zoom, hh = cam.height / 2 / v.zoom;
  return b.x >= v.x - hw && b.x + b.w <= v.x + hw && b.y >= v.y - hh && b.y + b.h <= v.y + hh;
}

describe('ruído e trauma', () => {
  it('ruído suave: determinístico, em [-1, 1] e contínuo', () => {
    for (let t = 0; t < 20; t += 0.37) {
      const n = smoothNoise(t, 3);
      expect(n).toBe(smoothNoise(t, 3));
      expect(Math.abs(n)).toBeLessThanOrEqual(1);
      expect(Math.abs(smoothNoise(t + 0.001, 3) - n)).toBeLessThan(0.01);
    }
  });

  it('a tremida cresce com trauma², decai com o tempo e some', () => {
    const cam = new CameraRig(1);
    const b = boxes(['a', { x: -50, y: -50, w: 100, h: 100 }]);
    cam.step(SIM_DT, b, ['a']);
    const rest = cam.view(1);
    cam.shake(1);
    let maxOff = 0;
    for (let i = 0; i < 30; i++) {
      cam.step(SIM_DT, b, ['a']);
      const v = cam.view(1);
      maxOff = Math.max(maxOff, Math.hypot(v.x - rest.x, v.y - rest.y) * v.zoom);
    }
    expect(maxOff).toBeGreaterThan(1);
    expect(maxOff).toBeLessThanOrEqual(SHAKE_MAX.offset * Math.SQRT2 + 1e-6);
    for (let i = 0; i < 240; i++) cam.step(SIM_DT, b, ['a']);
    expect(cam.trauma).toBe(0);
    const v = cam.view(1);
    expect(v.x).toBeCloseTo(rest.x, 6);
    expect(v.rotation).toBe(0);
  });
});

describe('câmera', () => {
  it('auto nunca corta um alvo, nem com o alvo disparando e a câmera tremendo', () => {
    const cam = new CameraRig(2);
    cam.setAuto({ maxZoom: 1, margin: 80 });
    const a: Rect = { x: 0, y: 0, w: 200, h: 120 };
    const b: Rect = { x: 400, y: 0, w: 200, h: 120 };
    for (let i = 0; i < 360; i++) {
      b.x += 2400 * SIM_DT; // lançado longe
      b.y -= 300 * SIM_DT;
      if (i % 40 === 0) cam.shake(0.6);
      cam.step(SIM_DT, boxes(['a', a], ['b', b]), ['a', 'b']);
      expect(inside(cam, a)).toBe(true);
      expect(inside(cam, b)).toBe(true);
    }
  });

  it('auto enquadra só os visíveis; alvos explícitos incluem props', () => {
    const cam = new CameraRig();
    const all = boxes(['a', { x: 0, y: 0, w: 100, h: 100 }], ['door', { x: 2000, y: 0, w: 50, h: 400 }]);
    cam.step(1, all, ['a']);
    expect(cam.x).toBeCloseTo(50, 3);
    cam.setAuto({ targets: ['a', 'door'] });
    for (let i = 0; i < 600; i++) cam.step(SIM_DT, all, ['a']);
    expect(cam.x).toBeCloseTo(1025, 0);
    expect(union([...all.values()])).toEqual({ x: 0, y: 0, w: 2050, h: 400 });
  });

  it('pan, zoom e seguir', () => {
    const cam = new CameraRig();
    const b = boxes(['a', { x: 0, y: 0, w: 100, h: 100 }]);
    cam.step(SIM_DT, b, ['a']);
    cam.pan(500, 200, 0.5);
    cam.zoomTo(2, 0.25);
    for (let i = 0; i < 120; i++) cam.step(SIM_DT, b, ['a']);
    expect(cam.view(1)).toMatchObject({ x: 500, y: 200, zoom: 2 });
    cam.follow('a', { x: 10, y: 0 });
    for (let i = 0; i < 600; i++) cam.step(SIM_DT, b, ['a']);
    expect(cam.x).toBeCloseTo(60, 2);
  });
});

describe('efeitos', () => {
  it('faíscas e estrela somem no tempo de vida; mesma semente = mesmo resultado', () => {
    const run = () => {
      const fx = new Effects(4);
      fx.impact({ x: 10, y: 20 }, { size: 1, dir: { x: 1, y: 0 } });
      fx.speedLines({ frames: 10 });
      for (let i = 0; i < 4; i++) fx.step(SIM_DT);
      return fx.sparks.map((s) => [s.p.x, s.p.y]);
    };
    expect(run()).toEqual(run());
    const fx = new Effects(4);
    fx.impact({ x: 0, y: 0 });
    expect(fx.active).toBe(true);
    for (let i = 0; i < 120; i++) fx.step(SIM_DT);
    expect(fx.active).toBe(false);
  });
});

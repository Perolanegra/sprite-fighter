import { describe, expect, it } from 'vitest';
import { Actor } from './actor.js';
import { Animator } from './animator.js';
import { checkClip, eventsBetween, parseClip, sampleKeys, sampleSlot } from './clip.js';
import { EASINGS, ease } from './easing.js';
import { FixedClock, SIM_DT } from './loop.js';
import { deg2rad } from './math.js';
import { lookAt, solveTwoBone, SquashStretch } from './procedural.js';
import { testCharacter } from './testing.js';
import { DataError } from './validate.js';

const clip = (json: object) => parseClip({ id: 'c', ...json });

describe('easing', () => {
  it('todas começam em 0 e terminam em 1', () => {
    for (const [name, fn] of Object.entries(EASINGS)) {
      expect(fn(0), name).toBeCloseTo(0, 5);
      expect(fn(1), name).toBeCloseTo(1, 5);
    }
  });
  it('backOut passa do ponto (overshoot) e ease() limita a entrada', () => {
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => EASINGS.backOut(i / 49)))).toBeGreaterThan(1);
    expect(ease('linear', 2)).toBe(1);
  });
});

describe('FixedClock', () => {
  it('passos fixos de 1/120 s, independente do tamanho do quadro', () => {
    const a = new FixedClock();
    const b = new FixedClock();
    for (let i = 0; i < 60; i++) a.advance(1 / 60);
    for (let i = 0; i < 144; i++) b.advance(1 / 144);
    expect(a.steps).toBe(120);
    expect(b.steps).toBeGreaterThanOrEqual(119);
    expect(b.steps).toBeLessThanOrEqual(120);
  });
  it('timeScale desacelera; pausa congela; alpha é a sobra', () => {
    const c = new FixedClock();
    c.timeScale = 0.5;
    for (let i = 0; i < 10; i++) c.advance(0.1);
    expect(c.steps).toBe(60);
    c.paused = true;
    c.advance(0.1);
    expect(c.steps).toBe(60);
    expect(new FixedClock().advance(5).steps).toBe(30); // quadro enorme é limitado a 0,25 s
    c.paused = false;
    c.timeScale = 1;
    const { alpha } = c.advance(SIM_DT * 1.5);
    expect(alpha).toBeCloseTo(0.5, 5);
  });
});

describe('clipe', () => {
  const c = clip({
    loop: true,
    frames: 40,
    bones: { torso: [{ f: 0, rot: 0 }, { f: 20, rot: 10, ease: 'linear' }] },
    slots: { torso: [{ f: 0, slot: 'default' }] },
    events: [{ frame: 10, event: 'hit' }],
  });

  it('interpola entre as chaves e segura nas pontas', () => {
    const keys = c.bones.get('torso')!.rot!;
    expect(sampleKeys(keys, 10, 0)).toBeCloseTo(5);
    expect(sampleKeys(keys, 35, 0)).toBe(10);
  });

  it('eventos: uma vez por passagem, também na volta do loop', () => {
    expect(eventsBetween(c, 0, 9)).toEqual([]);
    expect(eventsBetween(c, 9, 11).map((e) => e.event)).toEqual(['hit']);
    expect(eventsBetween(c, 38, 52)).toHaveLength(1); // 50 = 40 + 10
  });

  it('erros claros: canal desconhecido, ordem, ease', () => {
    expect(() => clip({ bones: { torso: [{ f: 0, spin: 1 }] } })).toThrow(/canal desconhecido: spin/);
    expect(() => clip({ bones: { torso: [{ f: 5, rot: 1 }, { f: 2, rot: 0 }] } })).toThrow(/ordem de frame/);
    expect(() => clip({ bones: { torso: [{ f: 0, rot: 1, ease: 'wobble' }] } })).toThrow(DataError);
  });

  it('checkClip recusa osso ou slot que o rig não tem', () => {
    const rig = testCharacter().rig;
    expect(() => checkClip(clip({ bones: { tail: [{ f: 0, rot: 1 }] } }), rig)).toThrow(/osso "tail" não existe/);
    expect(() => checkClip(clip({ slots: { torso: [{ f: 0, slot: 'head_x' }] } }), rig)).toThrow(/não é slot/);
    expect(sampleSlot(c, 'torso', 5)).toBe('default');
  });
});

describe('Animator', () => {
  const rig = testCharacter().rig;
  const a = clip({ id: 'a', loop: true, frames: 60, bones: { arm_front_upper: [{ f: 0, rot: -40 }, { f: 60, rot: -40 }] } });
  const b = parseClip({ id: 'b', frames: 30, bones: { arm_front_upper: [{ f: 0, rot: 50 }, { f: 30, rot: 50 }] }, events: [{ frame: 12, event: 'boom' }] });
  const arm = rig.byName.get('arm_front_upper')!;

  it('crossfade sem salto: a rotação muda pouco a cada passo', () => {
    const an = new Animator(rig);
    const pose = rig.bones.map(() => ({ rotation: 0, offset: { x: 0, y: 0 }, scale: 1, slot: null as string | null }));
    an.play(a);
    let last = NaN;
    let maxStep = 0;
    for (let i = 0; i < 120; i++) {
      if (i === 30) an.play(b, { fade: 6 });
      an.advance(SIM_DT);
      an.apply(pose);
      const r = pose[arm]!.rotation;
      if (!Number.isNaN(last)) maxStep = Math.max(maxStep, Math.abs(r - last));
      last = r;
    }
    expect(last).toBeCloseTo(deg2rad(50));
    // 90° em 6 frames de 60 fps (12 passos), com smoothstep: < 15°/passo, nunca o corte seco de 90°.
    expect(maxStep).toBeLessThan(deg2rad(15));
  });

  it('camada com máscara só mexe nos ossos dela, por cima da base', () => {
    const an = new Animator(rig);
    an.addLayer('arms', ['arm_front_upper']);
    const pose = rig.bones.map(() => ({ rotation: 0, offset: { x: 0, y: 0 }, scale: 1, slot: null as string | null }));
    an.play(clip({ id: 'base', loop: true, frames: 10, bones: { torso: [{ f: 0, rot: 20 }], arm_front_upper: [{ f: 0, rot: 5 }] } }));
    an.play(b, { layer: 'arms', fade: 0 });
    an.advance(SIM_DT);
    an.apply(pose);
    expect(pose[rig.byName.get('torso')!]!.rotation).toBeCloseTo(deg2rad(20));
    expect(pose[arm]!.rotation).toBeCloseTo(deg2rad(50));
  });

  it('eventos disparam uma vez e o clipe sem loop termina', () => {
    const an = new Animator(rig);
    const seen: string[] = [];
    an.onEvent = (e) => seen.push(`${e.clip}:${e.event}`);
    an.play(b);
    for (let i = 0; i < 120; i++) an.advance(SIM_DT);
    expect(seen).toEqual(['b:boom']);
    expect(an.finished()).toBe(true);
  });
});

describe('procedural', () => {
  it('IK de 2 ossos alcança um alvo dentro do alcance', () => {
    const o = { x: 0, y: 0 };
    const t = { x: 60, y: 40 };
    const { upper, lower } = solveTwoBone(o, 50, 50, t, 1);
    const elbow = { x: Math.cos(upper) * 50, y: Math.sin(upper) * 50 };
    const hand = { x: elbow.x + Math.cos(lower) * 50, y: elbow.y + Math.sin(lower) * 50 };
    expect(hand.x).toBeCloseTo(60, 4);
    expect(hand.y).toBeCloseTo(40, 4);
  });

  it('IK fora do alcance estica na direção do alvo', () => {
    const { upper, lower } = solveTwoBone({ x: 0, y: 0 }, 50, 50, { x: 500, y: 0 }, 1);
    expect(upper).toBeCloseTo(0, 2);
    expect(lower).toBeCloseTo(0, 2);
  });

  it('o braço do personagem mira o alvo (também espelhado)', () => {
    for (const flip of [false, true]) {
      const actor = new Actor(testCharacter(), { hover: false, cloth: false, squash: false });
      actor.facing = flip ? -1 : 1;
      const target = { x: flip ? -50 : 50, y: 20 };
      actor.setReach('arm', ['arm_front_upper', 'arm_front_fore'], target);
      actor.step(SIM_DT);
      const hand = actor.sim.endWorld(actor.sim.bone('arm_front_fore'));
      expect(hand.x).toBeCloseTo(target.x, 1);
      expect(hand.y).toBeCloseTo(target.y, 1);
    }
  });

  it('look-at respeita o limite', () => {
    const actor = new Actor(testCharacter(), { hover: false, cloth: false, squash: false });
    actor.step(SIM_DT);
    const s = actor.sim;
    const torso = s.bone('torso');
    lookAt(s, torso, { x: 0, y: 1000 }, deg2rad(20));
    expect(Math.abs(s.pose[torso]!.rotation)).toBeCloseTo(deg2rad(20), 5);
  });

  it('tecido: arrasta ao acelerar, passa do ponto ao frear e assenta', () => {
    const actor = new Actor(testCharacter(), { hover: false, squash: false });
    const tail = actor.sim.bone('coat_tail_1');
    const offsets: number[] = [];
    for (let i = 0; i < 600; i++) {
      actor.velocity = { x: i < 120 ? 0 : i < 240 ? 900 : 0, y: i < 120 ? 0 : i < 240 ? 300 : 0 };
      actor.step(SIM_DT);
      offsets.push(actor.sim.pose[tail]!.rotation);
    }
    const moving = offsets.slice(130, 240);
    const braking = offsets.slice(240, 420);
    expect(Math.max(...moving.map(Math.abs))).toBeGreaterThan(0.02);
    // depois da freada o desvio troca de sinal (passa do ponto)…
    const sign = Math.sign(offsets[239]!);
    expect(braking.some((v) => Math.sign(v) === -sign && Math.abs(v) > 0.005)).toBe(true);
    // …e assenta
    expect(Math.abs(offsets.at(-1)!)).toBeLessThan(0.002);
  });

  it('squash & stretch: arrancar estica, frear achata', () => {
    const ss = new SquashStretch();
    for (let i = 0; i < 30; i++) ss.step({ x: 500, y: 0 }, { x: 4000, y: 0 }, SIM_DT);
    expect(ss.amount).toBeGreaterThan(0.05);
    for (let i = 0; i < 60; i++) ss.step({ x: 500, y: 0 }, { x: -4000, y: 0 }, SIM_DT);
    expect(ss.amount).toBeLessThan(-0.05);
  });
});

describe('determinismo', () => {
  it('a mesma sequência de passos dá a mesma pose', () => {
    const run = () => {
      const actor = new Actor(testCharacter());
      actor.play(clip({ id: 'w', loop: true, frames: 30, bones: { arm_front_upper: [{ f: 0, rot: 0 }, { f: 15, rot: 30, ease: 'sineInOut' }, { f: 30, rot: 0, ease: 'sineInOut' }] } }));
      for (let i = 0; i < 400; i++) {
        actor.velocity = { x: Math.sin(i / 30) * 800, y: 0 };
        actor.step(SIM_DT);
      }
      return JSON.stringify([actor.sim.pose, actor.sim.root]);
    };
    expect(run()).toBe(run());
  });
});

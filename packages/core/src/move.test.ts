import { describe, expect, it } from 'vitest';
import { SIM_DT } from './loop.js';
import { MoveRunner, checkMovePoses, parseMove, parseMoves } from './move.js';

const jab = {
  id: 'jab',
  poses: ['punch'],
  phases: [
    { name: 'preparo', frames: 4, pose: 'punch' },
    { name: 'ativo', frames: 5, hitboxes: [{ bone: 'hand_front', radius: 30 }] },
    { name: 'volta', frames: 10, pose: 'fly' },
  ],
  onHit: { hitstop: 6, knockback: [300, -20], targetPose: 'hurt', targetClip: 'hurt_light' },
};

describe('golpes: formato', () => {
  it('lê fases, hitboxes, onHit e o total de frames', () => {
    const m = parseMove(jab);
    expect(m.frames).toBe(19);
    expect(m.phases[1]!.hitboxes[0]).toEqual({ bone: 'hand_front', radius: 30, along: [0, 1] });
    expect(m.onHit).toMatchObject({ hitstop: 6, knockback: { x: 300, y: -20 }, targetPose: 'hurt', stun: 20 });
    expect(m.phases[0]!.transition).toBeNull();
  });

  it('mensagens de erro com o caminho do campo', () => {
    expect(() => parseMove({ id: 'x', phases: [] })).toThrow(/phases.*pelo menos uma fase/);
    expect(() => parseMove({ id: 'x', phases: [{ name: 'a', frames: 2, transition: 'wipe' }] })).toThrow(/phases\[0\]\.transition: esperado um de/);
    expect(() => parseMove({ id: 'x', phases: [{ name: 'a', frames: 2, motion: { type: 'dash' } }] })).toThrow(/phases\[0\]\.motion\.velocity/);
    expect(() => parseMoves([jab, jab])).toThrow(/"jab" repetido/);
  });

  it('pose inexistente gera erro claro na carga; provisória declarada é aceita', () => {
    const m = parseMove(jab);
    expect(() => checkMovePoses(m, { attacker: new Set(['fly']), base: 'fly' })).toThrow(/pose "punch" não existe/);
    expect(() => checkMovePoses(m, { attacker: new Set(['fly', 'punch']), base: 'fly', target: new Set(['fly']) })).toThrow(/não tem a pose "hurt"/);
    const bad = parseMove({ ...jab, poses: [] });
    expect(() => checkMovePoses(bad, { attacker: new Set(['fly', 'punch']), base: 'fly' })).toThrow(/phases\[0\]\.pose: "punch" não está em "poses"/);
    // "dodge" provisória (está no conjunto de poses disponíveis do personagem).
    const dodge = parseMove({ id: 'dodge', poses: ['dodge'], phases: [{ name: 'a', frames: 9, pose: 'dodge' }] });
    expect(() => checkMovePoses(dodge, { attacker: new Set(['fly', 'dodge']), base: 'fly' })).not.toThrow();
  });
});

describe('golpes: sequenciador de fases', () => {
  it('entra em cada fase no frame certo e as hitboxes só existem nos frames ativos', () => {
    const r = new MoveRunner(parseMove(jab));
    expect(r.start().map((e) => e.phase.name)).toEqual(['preparo']);
    const active: number[] = [];
    const entered: [number, string][] = [];
    for (let i = 1; i <= 60 && !r.finished; i++) {
      for (const e of r.step(SIM_DT)) entered.push([i, e.phase.name]);
      if (r.activeHitboxes.length) active.push(i);
    }
    // 120 Hz = 2 passos por frame de 60 fps: preparo 4 frames = 8 passos.
    expect(entered).toEqual([
      [8, 'ativo'],
      [18, 'volta'],
    ]);
    expect(active[0]).toBe(8);
    expect(active).toHaveLength(10);
    expect(r.finished).toBe(true);
    expect(r.activeHitboxes).toEqual([]);
  });

  it('fases de 0 frames passam direto; o registro de acerto zera a cada fase', () => {
    const r = new MoveRunner(parseMove({ id: 'x', phases: [{ name: 'a', frames: 0 }, { name: 'b', frames: 1 }, { name: 'c', frames: 1 }] }));
    expect(r.start().map((e) => e.phase.name)).toEqual(['a', 'b']);
    r.hitThisPhase.add('alvo');
    r.step(SIM_DT);
    r.step(SIM_DT);
    expect(r.phase.name).toBe('c');
    expect(r.hitThisPhase.size).toBe(0);
  });
});

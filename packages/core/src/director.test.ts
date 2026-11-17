import { describe, expect, it } from 'vitest';
import { parseClip } from './clip.js';
import { Director } from './director.js';
import { SIM_DT } from './loop.js';
import { parseMoves } from './move.js';
import { fighterCharacter } from './testing.js';

const MOVES = parseMoves([
  {
    id: 'shoot',
    phases: [
      { name: 'mira', frames: 4 },
      { name: 'tiro', frames: 10, spawn: { projectile: 'bullet', from: 'hand_front', speed: 1200, radius: 6, aim: true } },
    ],
    onHit: { knockback: [100, 0] },
  },
  { id: 'dodge', poses: ['dodge'], phases: [{ name: 'esquiva', frames: 12, pose: 'dodge', motion: { type: 'offset', by: [0, -200] } }, { name: 'volta', frames: 6, pose: 'fly' }] },
]);
const CLIPS = new Map([['idle', parseClip({ id: 'idle', frames: 30, loop: true, bones: {} })]]);

function characters() {
  return { a: { character: fighterCharacter(), moves: MOVES }, b: { character: fighterCharacter(), moves: MOVES } };
}

const CAST = { a: { at: [0, 0], clip: 'idle' }, b: { at: [1500, 0], facing: -1 } };

async function director(steps: unknown[], extra: Record<string, unknown> = {}) {
  return Director.create({ cast: CAST, steps, ...extra }, { characters: characters(), clips: CLIPS, incomingDistance: 600 });
}

/** Instantes (s) em que cada passo começou/terminou (evento "step"). */
function timeline(d: Director, until: number) {
  const log: string[] = [];
  d.on('step', (e: { id: string | null; do: string; phase: string; time: number }) => log.push(`${e.phase} ${e.id ?? e.do} ${e.time.toFixed(3)}`));
  d.seek(0);
  while (d.time < until - 1e-9) d.step();
  return log;
}

describe('Director', () => {
  it('at, after (+delay) e duração dos passos', async () => {
    const d = await director([
      { id: 'ida', at: 0.5, actor: 'a', do: 'moveTo', params: { to: [300, 0], duration: 1 } },
      { id: 'pausa', after: 'ida', delay: 0.25, do: 'wait', params: { seconds: 0.5 } },
      { id: 'pose', after: 'pausa', actor: 'a', do: 'pose', params: { name: 'punch', transition: 'cut' } },
    ]);
    const log = timeline(d, 3);
    expect(log).toEqual(['start ida 0.500', 'end ida 1.500', 'start pausa 1.750', 'end pausa 2.250', 'start pose 2.250', 'end pose 2.250']);
    expect(d.world.fighter('a').actor.position.x).toBeCloseTo(300, 6);
    expect(d.world.fighter('a').actor.poseName).toBe('punch');
  });

  it('mede a duração (fim do último passo + tail) e avisa o fim', async () => {
    const d = await director([{ at: 1, do: 'wait', params: { seconds: 0.5 } }], { tail: 0.5 });
    expect(d.duration).toBeCloseTo(2, 2);
    let ended = 0;
    d.on('end', () => ended++);
    d.play();
    for (let i = 0; i < 10; i++) d.advance(0.25);
    expect(ended).toBe(1);
    expect(d.playing).toBe(false);
    expect(d.time).toBeCloseTo(2, 2);
  });

  it('on: evento do mundo (nth) dispara o passo; projétil chegando → esquiva', async () => {
    const d = await director([
      { at: 0.1, actor: 'a', do: 'move', params: { id: 'shoot', target: 'b' } },
      { at: 0.6, actor: 'a', do: 'move', params: { id: 'shoot', target: 'b' } },
      { id: 'e1', on: 'incoming:a->b', actor: 'b', do: 'move', params: { id: 'dodge' } },
      { id: 'e2', on: 'incoming:a->b', nth: 2, actor: 'b', do: 'pose', params: { name: 'hurt', transition: 'cut' } },
    ]);
    const log = timeline(d, 1.6);
    const starts = log.filter((l) => l.startsWith('start e'));
    expect(starts.map((l) => l.split(' ')[1])).toEqual(['e1', 'e2']);
    // A bala sai no fim da mira (4 frames = 0,067 s) e avisa ao chegar a 600 px do alvo.
    const t1 = Number(starts[0]!.split(' ')[2]);
    expect(t1).toBeGreaterThan(0.17);
    expect(t1).toBeLessThan(0.9);
    expect(d.world.hits.length).toBe(0); // a esquiva tirou o alvo da linha
    expect(d.unfired()).toEqual([]);
  });

  it('passo `on` cujo evento nunca acontece fica em unfired()', async () => {
    const d = await director([{ id: 'nunca', on: 'hit:a->b', actor: 'b', do: 'hover' }, { at: 0, do: 'wait', params: { seconds: 0.2 } }]);
    d.seek(d.duration);
    expect(d.unfired().map((s) => s.id)).toEqual(['nunca']);
  });

  it('parallel: filhos juntos (com delay), termina quando todos terminam; o payload do evento chega ao fx', async () => {
    const d = await director([
      { id: 'p', at: 0.2, actor: 'a', do: 'parallel', params: { steps: [{ do: 'wait', params: { seconds: 0.3 } }, { delay: 0.1, do: 'pose', params: { name: 'punch' } }] } },
      { id: 'depois', after: 'p', do: 'wait', params: { seconds: 0.1 } },
    ]);
    const log = timeline(d, 1);
    expect(log.filter((l) => /^(start|end) (p|depois) /.test(l))).toEqual(['start p 0.200', 'end p 0.500', 'start depois 0.500', 'end depois 0.600']);
    expect(log).toContain('start pose 0.300');
  });

  it('porta: surge, fecha (sólida só no fim da animação) e o contato dispara o passo `on`', async () => {
    const d = await director([
      { at: 0, do: 'spawnProp', params: { type: 'door', id: 'porta', at: [600, -400], size: [40, 800] } },
      { id: 'fecha', at: 0.1, do: 'prop', params: { id: 'porta', action: 'close', duration: 0.2 } },
      { at: 0.4, actor: 'a', do: 'moveTo', params: { to: [900, 0], duration: 0.5 } },
      { id: 'bateu', on: 'hit:porta->a', actor: 'a', do: 'parallel', params: { steps: [{ do: 'hover' }, { do: 'touch', params: { prop: 'porta', gap: 4 } }] } },
    ]);
    d.seek(0.2);
    expect(d.world.props.get('porta')).toMatchObject({ state: 'closed', solid: false });
    d.seek(0.31);
    expect(d.world.props.get('porta')!.solid).toBe(true);
    let touched = -1;
    d.on('step', (e: { id: string | null; phase: string; time: number }) => {
      if (e.id === 'bateu' && e.phase === 'end') touched = e.time;
    });
    d.seek(0);
    while (touched < 0 && d.time < 1.2) d.step();
    expect(d.world.hits.map((h) => `${h.attacker}->${h.target}`)).toContain('porta->a');
    d.step(); // o esqueleto acompanha a posição nova
    const b = d.world.fighter('a').actor.bounds();
    expect(Math.abs(b.x + b.w - (600 - 4))).toBeLessThan(3);
  });

  it('enter: atravessa o prop recortado e some no fim', async () => {
    const d = await director([
      { at: 0, do: 'spawnProp', params: { type: 'door', id: 'porta', at: [300, -300], size: [40, 600] } },
      { id: 'entra', at: 0.3, actor: 'a', do: 'enter', params: { prop: 'porta', duration: 0.5 } },
    ]);
    d.seek(0.5);
    const hide = d.hidden.get('a')!;
    expect(hide[0]).toEqual({ x: 320, y: -300 }); // plano no meio da porta
    expect(d.world.fighter('a').actor.opacity).toBe(1);
    d.seek(0.9);
    expect(d.hidden.has('a')).toBe(false);
    const a = d.world.fighter('a').actor;
    expect(a.opacity).toBe(0);
    expect(a.position.x).toBeGreaterThan(320); // passou do plano
  });

  it('seek é determinístico: igual a tocar até lá, em qualquer ordem de seeks', async () => {
    const d = await director([
      { at: 0.1, actor: 'a', do: 'move', params: { id: 'shoot', target: 'b' } },
      { on: 'incoming:a->b', actor: 'b', do: 'move', params: { id: 'dodge' } },
      { at: 0.2, actor: 'a', do: 'moveTo', params: { route: 'M 0 0 C 200 -200 600 200 800 0', duration: 1 } },
      { at: 0.4, do: 'fx', params: { type: 'impact_big', at: [100, 100] } },
    ]);
    const state = () => {
      const w = d.world;
      return JSON.stringify({
        t: d.time.toFixed(6),
        f: [...w.fighters.values()].map((f) => [f.actor.position, f.actor.velocity, f.actor.poseName, f.actor.sim.world.map((m) => [...m])]),
        p: w.projectiles.map((p) => p.position),
        cam: [w.camera.x, w.camera.y, w.camera.zoom, w.camera.trauma],
      });
    };
    d.seek(0);
    d.play();
    while (d.time < 0.9 - 1e-9) d.advance(SIM_DT);
    const played = state();
    d.seek(1.4);
    d.seek(0.9);
    expect(state()).toBe(played);
    d.seek(0.3);
    d.seek(0.9);
    expect(state()).toBe(played);
  });

  it('dois diretores com o mesmo Character não mexem um no outro (nem na pose do Character)', async () => {
    const shared = fighterCharacter();
    const opts = { characters: { a: { character: shared, moves: MOVES } }, clips: CLIPS };
    const one = await Director.create({ cast: { a: { at: [0, 0], pose: 'punch' } }, steps: [] }, opts);
    const two = await Director.create({ cast: { a: { at: [0, 0] } }, steps: [] }, opts);
    const before = shared.pose;
    one.seek(0);
    two.seek(0);
    expect(one.world.fighter('a').actor.poseName).toBe('punch');
    expect(two.world.fighter('a').actor.poseName).toBe(shared.basePose ?? before);
    expect(shared.pose).toBe(before);
    one.dispose();
    two.dispose();
  });
});

describe('Director: câmera no instante 0', () => {
  /** Enquadramento esperado, calculado à parte: centro da caixa dos atores e o zoom que a faz caber com a margem. */
  function expected(d: Director, w: number, h: number, margin: number, maxZoom: number) {
    const boxes = d.fighters.map((f) => f.actor.bounds());
    const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
    const zoom = Math.min(maxZoom, (w - 2 * margin) / (x1 - x0), (h - 2 * margin) / (y1 - y0));
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom, rotation: 0 };
  }
  const create = (viewport = { width: 1280, height: 720 }) =>
    Director.create(
      { cast: { a: { at: [200, 300], scale: 0.4, clip: 'idle' }, b: { at: [1400, 420], scale: 0.4, facing: -1 } }, camera: { mode: 'auto', margin: 120, maxZoom: 0.8 }, steps: [{ at: 0.1, actor: 'b', do: 'moveTo', params: { to: [2600, 420], duration: 0.4 } }] },
      { characters: characters(), clips: CLIPS, viewport },
    );
  const close = (a: Record<string, number>, b: Record<string, number>) => {
    for (const k of ['x', 'y', 'zoom', 'rotation']) expect(a[k], k).toBeCloseTo(b[k]!, 6);
  };

  it('o quadro em t = 0 já é o enquadramento calculado, com os atores no lugar', async () => {
    const d = await create();
    expect(d.time).toBe(0);
    // Atores posicionados antes do primeiro passo (não na origem, não em escala 1).
    const [a, b] = d.fighters.map((f) => f.actor.bounds());
    expect(a!.x + a!.w / 2).toBeCloseTo(200, -2);
    expect(b!.x + b!.w / 2).toBeCloseTo(1400, -2);
    close(d.world.camera.view(0), expected(d, 1280, 720, 120, 0.8));
    close(d.world.camera.view(1), expected(d, 1280, 720, 120, 0.8)); // sem interpolação vinda de outro lugar
  });

  it('seek(0) depois de tocar e um tamanho novo em t = 0 também saem enquadrados', async () => {
    const d = await create();
    const first = d.world.camera.view(1);
    d.play();
    d.advance(0.6);
    d.pause();
    expect(d.world.camera.view(1).x).not.toBeCloseTo(first.x, 3); // a câmera andou
    d.seek(0);
    close(d.world.camera.view(1), first);
    d.viewport = { width: 800, height: 800 };
    close(d.world.camera.view(1), expected(d, 800, 800, 120, 0.8));
  });

  it('entre quadros consecutivos a câmera continua suavizada', async () => {
    const d = await create();
    const z0 = d.world.camera.view(1).zoom;
    d.fighters[1]!.actor.position = { x: 3000, y: 420 }; // o alvo salta: a câmera não pula junto
    d.step();
    const z1 = d.world.camera.view(1).zoom;
    const target = expected(d, 1280, 720, 120, 0.8).zoom;
    expect(z1).toBeLessThan(z0);
    expect(z1).toBeGreaterThan(target);
  });
});

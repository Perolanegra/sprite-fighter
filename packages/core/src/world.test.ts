import { describe, expect, it } from 'vitest';
import { Actor } from './actor.js';
import { parseClip } from './clip.js';
import { SIM_DT } from './loop.js';
import { DEG } from './math.js';
import { parseMoves } from './move.js';
import { fighterCharacter as fighterChar } from './testing.js';
import { World, type HitEvent } from './world.js';
import { registerAction } from './actions.js';

const MOVES = parseMoves([
  {
    id: 'jab',
    poses: ['punch'],
    phases: [
      { name: 'preparo', frames: 4, pose: 'punch' },
      { name: 'ativo', frames: 4, hitboxes: [{ bone: 'hand_front', radius: 20 }] },
      { name: 'ativo2', frames: 4, hitboxes: [{ bone: 'hand_front', radius: 20 }] },
      { name: 'volta', frames: 6, pose: 'fly' },
    ],
    onHit: { knockback: [400, 0], stun: 10, targetPose: 'hurt', targetClip: 'hurt_light' },
  },
  { id: 'dodge', poses: ['dodge'], phases: [{ name: 'esquiva', frames: 6, pose: 'dodge', motion: { type: 'offset', by: [0, -100] } }, { name: 'volta', frames: 6, pose: 'fly' }] },
]);
const CLIPS = new Map([['hurt_light', parseClip({ id: 'hurt_light', frames: 10, bones: {} })]]);

/** `gap` = distância do alvo; com facing 1 e gap 0 os dois se sobrepõem por inteiro. */
function setup(gap: number, facing: 1 | -1 = -1) {
  const world = new World({ clips: CLIPS, seed: 1 });
  const a = new Actor(fighterChar(), { hover: false, cloth: false, squash: false });
  const b = new Actor(fighterChar(), { hover: false, cloth: false, squash: false });
  b.position = { x: gap, y: 0 };
  b.facing = facing;
  world.add('a', a, MOVES);
  world.add('b', b, MOVES);
  world.step(SIM_DT);
  return { world, a, b };
}

describe('World: golpes e contato', () => {
  it('a hitbox só acerta nas fases ativas, uma vez por fase, e o alvo reage sozinho', () => {
    const { world, b } = setup(0, 1);
    const hits: HitEvent[] = [];
    world.on('hit:a->b', (e: HitEvent) => hits.push(e));
    world.perform('a', 'jab', 'b');
    for (let i = 0; i < 7; i++) world.step(SIM_DT); // ainda no preparo
    expect(hits).toHaveLength(0);
    world.step(SIM_DT); // entra no "ativo"
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ attacker: 'a', target: 'b', move: 'jab', phase: 'ativo', by: 'hitbox' });
    expect(b.poseName).toBe('hurt');
    expect(world.fighter('b').motion?.kind).toBe('knockback');
    world.step(SIM_DT);
    expect(b.velocity.x).toBeGreaterThan(0); // recuo no sentido do atacante
    expect(world.fighter('b').stun).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) world.step(SIM_DT);
    // A segunda fase ativa acerta de novo (se o alvo ainda estiver ao alcance), nunca mais que isso.
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(new Set(hits.map((h) => h.phase)).size).toBe(hits.length);
    // Fim da reação: volta à pose base.
    for (let i = 0; i < 60; i++) world.step(SIM_DT);
    expect(b.poseName).toBe('fly');
    expect(world.fighter('a').runner).toBeNull();
  });

  it('longe demais: nenhum contato', () => {
    const { world } = setup(5000);
    world.perform('a', 'jab', 'b');
    for (let i = 0; i < 60; i++) world.step(SIM_DT);
    expect(world.hits).toHaveLength(0);
  });

  it('determinístico: a mesma cena dá os mesmos contatos e posições', () => {
    const run = () => {
      const { world, b } = setup(0, 1);
      world.perform('a', 'jab', 'b');
      for (let i = 0; i < 90; i++) world.step(SIM_DT);
      return { hits: world.hits.map((h) => [h.time, h.phase]), x: b.position.x };
    };
    expect(run()).toEqual(run());
  });
});

describe('troca de pose', () => {
  it('o quadril não pula e a escala não muda (âncora no quadril)', () => {
    const char = fighterChar();
    const actor = new Actor(char, { hover: false, cloth: false, squash: false });
    actor.position = { x: 300, y: 120 };
    actor.step(SIM_DT);
    const hips = () => actor.sim.pivotWorld(actor.sim.bone('hips'));
    const before = hips();
    for (const pose of ['punch', 'hurt', 'fly']) {
      actor.setPose(pose, { transition: 'cut' });
      actor.step(SIM_DT);
      expect(hips().x).toBeCloseTo(before.x, 6);
      expect(hips().y).toBeCloseTo(before.y, 6);
      expect(actor.sim.root.scale).toBe(1);
    }
  });

  it('transição padrão: smear ao sair da base, afterimage ao voltar', () => {
    const actor = new Actor(fighterChar(), { hover: false });
    actor.setPose('punch');
    expect(actor.transition?.kind).toBe('smear');
    actor.setPose('fly');
    expect(actor.transition?.kind).toBe('afterimage');
  });

  it('pose provisória: imagem de outra pose com a variação na raiz', () => {
    const { world, b } = setup(5000);
    world.perform('b', 'dodge');
    world.step(SIM_DT);
    expect(b.poseName).toBe('dodge');
    expect(b.imagePose?.provisional?.from).toBe('fly');
    expect(b.sim.root.rotation).toBeCloseTo(90 * DEG, 6);
    // Esquiva sem golpe não vira para o alvo.
    expect(b.facing).toBe(-1);
  });
});

describe('game feel', () => {
  it('hitstop congela atacante, alvo e a troca de pose; a câmera continua tremendo', () => {
    const { world, a, b } = setup(0, 1);
    const moves = parseMoves([{ id: 'hit', poses: ['punch'], phases: [{ name: 'ativo', frames: 6, pose: 'punch', hitboxes: [{ bone: 'hand_front', radius: 20 }] }, { name: 'volta', frames: 6, pose: 'fly' }], onHit: { hitstop: 10, knockback: [400, 0], targetPose: 'hurt', fx: ['impact_big'] } }]);
    world.fighter('a').moves.set('hit', moves.get('hit')!);
    world.perform('a', 'hit', 'b');
    let i = 0;
    while (!world.hits.length && i++ < 20) world.step(SIM_DT);
    expect(world.hits).toHaveLength(1);
    expect(world.fighter('b').hitstop).toBe(10);
    expect(b.smearing!.t).toBeGreaterThanOrEqual(2); // a troca para "hurt" congela no 2º quadro do borrão
    const snap = () => ({ a: { ...a.position }, b: { ...b.position }, smear: b.smearing!.t, phase: world.fighter('a').runner?.phase.name, trauma: world.camera.trauma, view: world.camera.view(1) });
    const s0 = snap();
    world.step(SIM_DT);
    const s1 = snap();
    expect(s1.a).toEqual(s0.a);
    expect(s1.b).toEqual(s0.b);
    expect(s1.smear).toBe(s0.smear); // o borrão não anda no congelamento
    expect(s1.phase).toBe(s0.phase);
    expect(s1.trauma).toBeLessThan(s0.trauma); // a câmera anda em tempo real
    expect(s1.view).not.toEqual(s0.view);
    // O flash corre mesmo congelado.
    expect(b.flashing).not.toBeNull();
    for (let k = 0; k < 10; k++) world.step(SIM_DT);
    expect(b.flashing).toBeNull();
    // 10 frames de 60 fps = 20 passos: depois disso tudo volta a andar.
    for (let k = 0; k < 12; k++) world.step(SIM_DT);
    expect(world.fighter('b').hitstop).toBeLessThanOrEqual(0);
    expect(b.position.x).toBeGreaterThan(s0.b.x);
  });

  it('câmera lenta: a simulação anda mais devagar só no trecho', () => {
    const { world } = setup(5000);
    world.slowMotion(0.25, 0.5, 0);
    const t0 = world.time;
    for (let i = 0; i < 60; i++) world.step(SIM_DT); // 0,5 s reais
    expect(world.time - t0).toBeCloseTo(0.125, 6);
    for (let i = 0; i < 60; i++) world.step(SIM_DT);
    expect(world.time - t0).toBeCloseTo(0.625, 6);
    expect(world.timeScale).toBe(1);
  });

  it('toda troca não-cut passa pelo borrão (2–3 frames); cut não', () => {
    const actor = new Actor(fighterChar(), { hover: false });
    actor.velocity = { x: 900, y: 0 };
    actor.setPose('punch');
    expect(actor.smearing).toMatchObject({ t: 0, frames: 3 });
    for (let i = 0; i < 6; i++) actor.step(SIM_DT);
    expect(actor.smearing).toBeNull();
    actor.setPose('fly'); // volta: borrão + cópias da pose que saiu
    expect(actor.smearing).not.toBeNull();
    expect(actor.ghostCount).toBe(3);
    actor.setPose('hurt', { transition: 'flash' });
    expect(actor.smearing?.frames).toBe(2);
    expect(actor.flashing).not.toBeNull();
    for (let i = 0; i < 40; i++) actor.step(SIM_DT);
    actor.setPose('fly', { transition: 'cut' });
    expect(actor.smearing).toBeNull();
    expect(actor.ghostCount).toBe(0);
  });

  it('afterimage geral: emite cópias durante N frames e elas somem', () => {
    const actor = new Actor(fighterChar(), { hover: false });
    actor.afterimage({ frames: 8, every: 2, life: 6 });
    for (let i = 0; i < 16; i++) actor.step(SIM_DT);
    expect(actor.ghostCount).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 20; i++) actor.step(SIM_DT);
    expect(actor.ghostCount).toBe(0);
  });
});

describe('World: ação TS com parâmetros', () => {
  it('"run": { action, params } chama a ação com os parâmetros da fase; "run": "<nome>" com params vazio', () => {
    const got: Record<string, unknown>[] = [];
    registerAction('teste_params', ({ params }) => void got.push(params));
    const moves = parseMoves([
      { id: 'com', phases: [{ name: 'f', frames: 2, run: { action: 'teste_params', params: { distance: 140, side: 'back' } } }] },
      { id: 'sem', phases: [{ name: 'f', frames: 2, run: 'teste_params' }] },
    ]);
    const world = new World({ clips: CLIPS, seed: 1 });
    world.add('a', new Actor(fighterChar(), { hover: false, cloth: false, squash: false }), moves);
    world.step(SIM_DT);
    world.perform('a', 'com');
    for (let i = 0; i < 8; i++) world.step(SIM_DT);
    world.perform('a', 'sem');
    for (let i = 0; i < 8; i++) world.step(SIM_DT);
    expect(got).toEqual([{ distance: 140, side: 'back' }, {}]);
  });
});

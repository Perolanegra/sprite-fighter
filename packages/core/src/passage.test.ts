import { describe, expect, it } from 'vitest';
import { parseClip } from './clip.js';
import { Actor } from './actor.js';
import { Director } from './director.js';
import { fitScale, hiddenQuad, hoverNear, passPlan, planePoint, sideDistance, spanMiss } from './passage.js';
import { anchorNames, propAnchor, propOpening } from './props.js';
import { parseScript } from './script.js';
import { checkScene, passCheckErrors } from './script-check.js';
import { fighterCharacter } from './testing.js';
import type { Prop } from './world.js';

const door = (x = 300, y = -300, w = 40, h = 600, facing?: 1 | -1): Prop => ({ id: 'porta', type: 'door', box: { x, y, w, h }, solid: false, state: 'open', ...(facing ? { facing } : {}) });

describe('passagem (geometria)', () => {
  const op = { box: { x: 300, y: -300, w: 40, h: 600 }, axis: 'x' as const };

  it('plano no meio da caixa, lado visível pelo ponto, vão no eixo transversal', () => {
    const pl = passPlan(op, { x: 0, y: 0 });
    expect(pl).toEqual({ axis: 'x', plane: 320, side: -1, span: [-300, 300] });
    expect(passPlan(op, { x: 900, y: 0 }).side).toBe(1);
    expect(passPlan(op, { x: 320, y: 0 }, 1).side).toBe(1);
    expect(sideDistance(pl, { x: 120, y: 0 })).toBe(200);
    expect(sideDistance(pl, { x: 400, y: 0 })).toBe(-80);
    expect(planePoint(pl, -50)).toEqual({ x: 370, y: 0 });
  });

  it('recorte: o lado de trás do plano, na altura do vão', () => {
    const q = hiddenQuad(passPlan(op, { x: 0, y: 0 }), 1000);
    expect(q).toEqual([{ x: 320, y: -300 }, { x: 1320, y: -300 }, { x: 1320, y: 300 }, { x: 320, y: 300 }]);
  });

  it('fora do vão: negativo antes do começo, positivo depois do fim', () => {
    const pl = passPlan(op, { x: 0, y: 0 });
    expect(spanMiss(pl, { x: 0, y: 0 })).toBe(0);
    expect(spanMiss(pl, { x: 0, y: -342 })).toBe(-42);
    expect(spanMiss(pl, { x: 0, y: 310 })).toBe(10);
    // Alçapão (eixo y): o vão é em x.
    const trap = passPlan({ box: { x: 0, y: 0, w: 100, h: 20 }, axis: 'y' }, { x: 50, y: -100 });
    expect(trap).toMatchObject({ plane: 10, side: -1, span: [0, 100] });
    expect(spanMiss(trap, { x: 130, y: 0 })).toBe(30);
  });

  it('escala que cabe no vão e flutuação perto do plano', () => {
    const pl = passPlan(op, { x: 0, y: 0 });
    expect(fitScale(pl, 1200)).toBeCloseTo(0.45);
    expect(hoverNear(0, 100)).toBe(0);
    expect(hoverNear(-30, 100)).toBe(0);
    expect(hoverNear(50, 100)).toBeCloseTo(0.5);
    expect(hoverNear(200, 100)).toBe(1);
  });
});

describe('âncoras de prop', () => {
  it('porta: opening, front (do lado do facing), top, bottom e as de caixa', () => {
    expect(anchorNames('door')).toEqual(expect.arrayContaining(['opening', 'front', 'top', 'bottom', 'center', 'left', 'right']));
    const p = door();
    expect(propAnchor(p, 'opening')).toEqual({ x: 320, y: 0 });
    expect(propAnchor(p, 'top')).toEqual({ x: 320, y: -300 });
    expect(propAnchor(p, 'bottom')).toEqual({ x: 320, y: 300 });
    expect(propAnchor(p, 'front').x).toBeLessThan(300);
    expect(propAnchor(door(300, -300, 40, 600, 1), 'front').x).toBeGreaterThan(340);
    expect(propOpening(p)).toEqual({ box: p.box, axis: 'x' });
  });

  it('acompanham a posição e o tamanho atuais', () => {
    const p = door();
    p.box = { x: 500, y: 0, w: 80, h: 400 };
    expect(propAnchor(p, 'opening')).toEqual({ x: 540, y: 200 });
    expect(propAnchor(p, 'top')).toEqual({ x: 540, y: 0 });
  });

  it('âncora desconhecida: erro com a lista; parede não tem abertura', () => {
    expect(() => propAnchor(door(), 'janela')).toThrow(/âncoras: .*opening/);
    expect(propOpening({ ...door(), type: 'wall' })).toBeNull();
  });
});

const CLIPS = new Map([['idle', parseClip({ id: 'idle', frames: 30, loop: true, bones: {} })]]);
const characters = () => ({ a: { character: fighterCharacter() } });

async function scene(steps: unknown[], cast: Record<string, unknown> = { a: { at: [-200, 0] } }) {
  return Director.create({ cast, steps }, { characters: characters(), clips: CLIPS });
}

const PORTA = { at: 0, do: 'spawnProp', params: { type: 'door', id: 'porta', at: [400, -400], size: [40, 800] } };

describe('centro visual', () => {
  it('é o centro da silhueta da pose em repouso, na escala e no lado atuais', () => {
    for (const facing of [1, -1] as const) {
      const a = new Actor(fighterCharacter(), { scale: 0.5, hover: false, cloth: false });
      a.position = { x: 100, y: 50 };
      a.facing = facing;
      a.settle();
      const b = a.bounds();
      const c = a.visualCenter();
      expect(Math.abs(c.x - (b.x + b.w / 2)), `facing ${facing}`).toBeLessThan(2);
      expect(Math.abs(c.y - (b.y + b.h / 2)), `facing ${facing}`).toBeLessThan(2);
    }
  });
});

describe('moveTo por âncora', () => {
  it('formato: { prop, anchor, offset }; relative e align conferidos', () => {
    const s = parseScript({ cast: { a: {} }, steps: [PORTA, { at: 0, actor: 'a', do: 'moveTo', params: { to: { prop: 'porta', anchor: 'front', offset: [0, 10] }, align: 'center', duration: 1 } }] });
    expect(s.steps[1]!.params['to']).toEqual({ prop: 'porta', anchor: 'front', offset: { x: 0, y: 10 } });
    const bad = (params: Record<string, unknown>) => () => parseScript({ cast: { a: {} }, steps: [PORTA, { at: 0, actor: 'a', do: 'moveTo', params: { duration: 1, ...params } }] });
    expect(bad({ to: { prop: 'porta', anchor: 'front' }, relative: true })).toThrow(/relative/);
    expect(bad({ route: 'M 0 0 L 10 10', align: 'center' })).toThrow(/align/);
    expect(bad({ to: { prop: 'nada', anchor: 'front' } })).toThrow(/prop criado no roteiro/);
    expect(bad({ to: { prop: 'porta' } })).toThrow(/anchor/);
  });

  it('checkScene: âncora que o tipo não tem; enter em prop sem abertura', () => {
    const chars = characters();
    const steps = (extra: unknown) => ({ cast: { a: {} }, steps: [PORTA, { at: 0, do: 'spawnProp', params: { type: 'wall', id: 'muro', at: [0, 0], size: [10, 10] } }, extra] });
    expect(() => checkScene(steps({ at: 0, actor: 'a', do: 'moveTo', params: { to: { prop: 'porta', anchor: 'janela' }, duration: 1 } }), { characters: chars })).toThrow(/não tem a âncora "janela".*opening/);
    expect(() => checkScene(steps({ at: 0, actor: 'a', do: 'enter', params: { prop: 'muro', duration: 1 } }), { characters: chars })).toThrow(/com abertura: door/);
    expect(() => checkScene(steps({ at: 0, actor: 'a', do: 'exit', params: { prop: 'porta', to: 'janela', duration: 1 } }), { characters: chars })).toThrow(/âncora "janela"/);
    expect(() => checkScene(steps({ at: 0, actor: 'a', do: 'moveTo', params: { to: { prop: 'porta', anchor: 'front' }, duration: 1 } }), { characters: chars })).not.toThrow();
  });

  it('o quadril chega na âncora; com align center, o centro visual', async () => {
    const d = await scene([PORTA, { at: 0.1, actor: 'a', do: 'moveTo', params: { to: { prop: 'porta', anchor: 'front', offset: [-20, 0] }, duration: 0.5 } }]);
    d.seek(0.8);
    const front = propAnchor(d.world.props.get('porta')!, 'front');
    const a = d.world.fighter('a').actor;
    expect(a.position.x).toBeCloseTo(front.x - 20, 6);
    expect(a.position.y).toBeCloseTo(front.y, 6);

    const c = await scene([PORTA, { at: 0.1, actor: 'a', do: 'moveTo', params: { to: { prop: 'porta', anchor: 'front' }, align: 'center', duration: 0.5 } }]);
    c.seek(0.8);
    const o = c.world.fighter('a').actor.visualOffset();
    expect(Math.hypot(o.x, o.y)).toBeGreaterThan(5); // o centro visual não é o quadril
    const at = c.world.fighter('a').actor;
    expect(at.position.x + o.x).toBeCloseTo(front.x, 0);
    expect(at.position.y + o.y).toBeCloseTo(front.y, 0);
  });

  it('acompanha o prop que se mexe no meio do caminho', async () => {
    const d = await scene([PORTA, { at: 0.1, actor: 'a', do: 'moveTo', params: { to: { prop: 'porta', anchor: 'opening' }, duration: 0.6 } }], { a: { at: [-200, 0], collideProps: false } });
    d.seek(0.3);
    const prop = d.world.props.get('porta')!;
    prop.box = { ...prop.box, x: prop.box.x + 150, y: prop.box.y - 60 };
    while (d.time < 0.9) d.step();
    const a = d.world.fighter('a').actor;
    const op = propAnchor(prop, 'opening');
    expect(a.position.x).toBeCloseTo(op.x, 6);
    expect(a.position.y).toBeCloseTo(op.y, 6);
  });
});

describe('enter e exit', () => {
  // A porta está bem acima do ator: só acerta quem mira a abertura.
  const HIGH = { at: 0, do: 'spawnProp', params: { type: 'door', id: 'porta', at: [500, -700], size: [40, 600] } };

  it('enter: mira a abertura de qualquer lugar, encolhe, sem flutuar no fim, recortado e some', async () => {
    const d = await scene([HIGH, { id: 'entra', at: 0.3, actor: 'a', do: 'enter', params: { prop: 'porta', duration: 0.6 } }]);
    const a = () => d.world.fighter('a').actor;
    const s0 = a().scale;
    d.seek(0.5);
    expect(d.hidden.get('a')![0]).toEqual({ x: 520, y: -700 });
    expect(a().scale).toBeLessThan(s0);
    expect(d.world.fighter('a').collideProps).toBe(false);
    let atPlane = -1;
    while (d.time < 1.2) {
      d.step();
      if (atPlane < 0 && a().visualCenter().x >= 520) atPlane = a().hoverWeight;
    }
    expect(atPlane).toBeLessThan(0.05);
    expect(a().opacity).toBe(0);
    expect(d.hidden.has('a')).toBe(false);
    expect(a().scale).toBeCloseTo(s0 * 0.7, 6);
    expect(d.passChecks).toHaveLength(1);
    expect(d.passChecks[0]).toMatchObject({ kind: 'enter', actor: 'a', prop: 'porta' });
    expect(Math.abs(d.passChecks[0]!.miss)).toBeLessThan(2);
    expect(passCheckErrors(d.passChecks)).toEqual([]);
  });

  it('exit: surge recortado na passagem, vai até front crescendo até a escala de antes', async () => {
    const d = await scene([
      HIGH,
      { id: 'entra', at: 0.3, actor: 'a', do: 'enter', params: { prop: 'porta', duration: 0.5 } },
      { id: 'sai', after: 'entra', delay: 0.3, actor: 'a', do: 'exit', params: { prop: 'porta', duration: 0.6 } },
    ]);
    const a = () => d.world.fighter('a').actor;
    const s0 = a().scale;
    d.seek(1.25);
    expect(a().opacity).toBe(1);
    expect(d.hidden.has('a')).toBe(true);
    expect(a().scale).toBeLessThan(s0);
    d.seek(2.2);
    expect(d.hidden.has('a')).toBe(false);
    expect(a().scale).toBeCloseTo(s0, 6);
    expect(d.world.fighter('a').collideProps).toBe(true);
    const front = propAnchor(d.world.props.get('porta')!, 'front');
    const o = a().visualOffset();
    expect(a().position.x + o.x).toBeCloseTo(front.x, 0);
    expect(a().position.y + o.y).toBeCloseTo(front.y, 0);
    expect(a().facing).toBe(-1); // saiu para a esquerda (front padrão)
    expect(d.passChecks.map((c) => c.kind)).toEqual(['enter', 'exit']);
    expect(passCheckErrors(d.passChecks)).toEqual([]);
  });

  it('determinístico: seek dá o mesmo estado que tocar', async () => {
    const d = await scene([HIGH, { at: 0.2, actor: 'a', do: 'enter', params: { prop: 'porta', duration: 0.5 } }]);
    d.seek(0);
    while (d.time < 0.55 - 1e-9) d.step();
    const played = JSON.stringify([d.world.fighter('a').actor.position, d.world.fighter('a').actor.scale, d.hidden.get('a')]);
    d.seek(0.9);
    d.seek(0.55);
    expect(JSON.stringify([d.world.fighter('a').actor.position, d.world.fighter('a').actor.scale, d.hidden.get('a')])).toBe(played);
  });

  it('contato com a porta fora do vão: erro com o deslocamento em px', async () => {
    // Porta fechada e baixa; o ator vai com o quadril (coordenada fixa) e bate com o corpo acima do vão.
    const d = await scene([
      { at: 0, do: 'spawnProp', params: { type: 'door', id: 'porta', at: [300, 40], size: [40, 600], state: 'closed' } },
      { at: 0.1, actor: 'a', do: 'moveTo', params: { to: [600, 0], duration: 0.6 } },
    ]);
    d.seek(1);
    const hits = d.passChecks.filter((c) => c.kind === 'contact');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.miss).toBeLessThan(-2);
    const [err] = passCheckErrors(hits);
    expect(err).toMatch(/no contato de "a" com "porta", o centro visual \(y -?\d+\) fica \d+ px acima da abertura \(y 40–640\): desloque \d+ px para baixo/);
    expect(err).toContain(`${Math.round(-hits[0]!.miss)} px acima`);
  });
});

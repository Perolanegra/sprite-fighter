import { describe, expect, it } from 'vitest';
import { parseRig, solveRig, pickPivot } from './rig.js';
import { Skeleton } from './skeleton.js';
import { rectGeometry } from './testing.js';
import { DataError } from './validate.js';

// Peças de teste: tronco 40×100 em pé, braço 20×60 em pé, cap 10×10.
const geos = { torso: rectGeometry(40, 100), arm: rectGeometry(20, 60), hand: rectGeometry(20, 20), cap: rectGeometry(10, 10) };
const parts = new Set(Object.keys(geos));
const geoOf = (n: string) => geos[n as keyof typeof geos];

const rigJson = (extra: object[] = []) => ({
  char: 't',
  bones: [
    { name: 'torso', part: 'torso', parent: null, pivot: { bbox: [0.5, 0.5] }, rotate: 0 },
    { name: 'arm', part: 'arm', parent: 'torso', pivot: 'top', attach: { bbox: [0.5, 0.1] }, angle: 0, layer: 'front' },
    { name: 'hand', part: 'hand', parent: 'arm', pivot: { bbox: [0.5, 0.5] }, attach: 'end', rotate: 0, layer: 'back' },
    ...extra,
  ],
  caps: [{ name: 'elbow', part: 'cap', bone: 'hand' }],
});

describe('parseRig', () => {
  it('aceita um rig válido', () => {
    const spec = parseRig(rigJson(), parts);
    expect(spec.bones.map((b) => b.name)).toEqual(['torso', 'arm', 'hand']);
    expect(spec.bones[1]!.layer).toBe('front');
  });

  it.each([
    [{ name: 'x', part: 'nope', parent: 'torso' }, 'peça "nope" não existe no atlas'],
    [{ name: 'x', part: 'arm', parent: 'ghost' }, 'mãe "ghost" não existe'],
    [{ name: 'arm', part: 'arm', parent: 'torso' }, 'osso "arm" repetido'],
    [{ name: 'x', part: 'arm', parent: 'torso', angle: 1, rotate: 2 }, 'use "angle" OU "rotate"'],
    [{ name: 'x', part: 'arm', parent: 'torso', pivot: 'middle' }, 'esperado um de'],
  ])('erro claro: %j', (bone, message) => {
    expect(() => parseRig(rigJson([bone]), parts, 'rig t')).toThrowError(new RegExp(message.replace(/[()[\]]/g, '\\$&')));
  });

  it('detecta ciclos e diz onde', () => {
    const json = {
      char: 't',
      bones: [
        { name: 'root', part: 'torso', parent: null },
        { name: 'a', part: 'arm', parent: 'b' },
        { name: 'b', part: 'arm', parent: 'a' },
      ],
    };
    expect(() => parseRig(json, parts)).toThrow(DataError);
    expect(() => parseRig(json, parts)).toThrow(/ciclo/);
  });
});

describe('solveRig + Skeleton', () => {
  const solved = solveRig(parseRig(rigJson(), parts), geoOf);
  const arm = solved.bones[1]!;

  it('pivot "top" escolhe a ponta de cima e "angle" aponta o eixo no mundo', () => {
    expect(arm.P.y).toBeLessThan(arm.D.y);
    // braço em pé (eixo pra baixo = 90°) apontado pra direita (0°): gira -90°
    expect(arm.R).toBeCloseTo(-Math.PI / 2, 2);
  });

  it('o encaixe é relativo ao pivô da mãe, no desenho dela', () => {
    // attach bbox (0.5, 0.1) do tronco 40×100 = (20, 10); pivô do tronco = (20, 50)
    expect(arm.T.x).toBeCloseTo(0, 5);
    expect(arm.T.y).toBeCloseTo(-40, 5);
  });

  it('o braço sai do ombro e vai pra direita; a mão fica na ponta', () => {
    const s = new Skeleton(solved);
    const shoulder = s.pivotWorld(1);
    expect(shoulder.x).toBeCloseTo(0, 4);
    expect(shoulder.y).toBeCloseTo(-40, 4);
    const end = s.endWorld(1);
    expect(end.x).toBeGreaterThan(shoulder.x + 30);
    expect(end.y).toBeCloseTo(shoulder.y, 0);
    const hand = s.pivotWorld(2);
    expect(hand.x).toBeCloseTo(end.x, 4);
    expect(hand.y).toBeCloseTo(end.y, 4);
  });

  it('girar um osso gira as filhas em volta da articulação dele', () => {
    const s = new Skeleton(solved);
    s.pose[1]!.rotation = Math.PI / 2;
    s.update();
    const shoulder = s.pivotWorld(1);
    const end = s.endWorld(1);
    expect(end.x).toBeCloseTo(shoulder.x, 0);
    expect(end.y).toBeGreaterThan(shoulder.y + 30);
    expect(s.pivotWorld(2).y).toBeCloseTo(end.y, 3);
  });

  it('flip espelha na horizontal em volta da raiz', () => {
    const s = new Skeleton(solved);
    const right = s.endWorld(1);
    s.root.flip = true;
    s.update();
    const left = s.endWorld(1);
    expect(left.x).toBeCloseTo(-right.x, 4);
    expect(left.y).toBeCloseTo(right.y, 4);
  });

  it('ordem de desenho: filhos de trás antes da mãe; cap depois da peça e da mãe', () => {
    const s = new Skeleton(solved);
    const order = s.drawList().map((d) => d.cap ?? d.part);
    // tronco, depois o braço (front) com a mão atrás dele (back) e o cap por cima dos dois
    expect(order).toEqual(['torso', 'hand', 'arm', 'elbow']);
  });

  it('slot escondido não é desenhado', () => {
    const s = new Skeleton(solved);
    s.pose[2]!.slot = null;
    expect(s.drawList().map((d) => d.part)).not.toContain('hand');
  });
});

describe('pickPivot', () => {
  it('"left"/"right" escolhem pela coordenada x', () => {
    const g = rectGeometry(80, 20);
    expect(pickPivot('left', g).P.x).toBeLessThan(pickPivot('right', g).P.x);
  });
});

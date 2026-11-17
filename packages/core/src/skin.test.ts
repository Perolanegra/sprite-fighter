import { describe, expect, it } from 'vitest';
import { deformLBS, invertAll, skinMatrices } from './deform.js';
import { restMatrices, skinToRig, SKIN_BODY, parseSkin } from './skin.js';
import { Skeleton } from './skeleton.js';
import { buildSkinMesh } from './mesh.js';

/** Esqueleto mínimo válido (corpo canônico) em linha reta, mais uma corrente. */
function skinJson(extra: object = {}) {
  const bones = SKIN_BODY.map(([name, parent], i) => ({ name, parent, head: [100 + i * 10, 100 + (i % 3) * 7], tail: [110 + i * 10, 95 + (i % 4) * 6] }));
  bones.push({ name: 'tie_1', parent: 'torso', head: [120, 120], tail: [140, 150] });
  return { char: 't', pose: 'fly', image: 't.png', bones, chains: [{ name: 'tie', bones: ['tie_1'] }], ...extra };
}

describe('parseSkin', () => {
  it('aceita o esqueleto canônico e recusa osso faltando, mãe errada ou ponto fora', () => {
    expect(parseSkin(skinJson(), { width: 400, height: 300 }).bones).toHaveLength(17);
    const missing = skinJson();
    missing.bones = missing.bones.filter((b) => b.name !== 'neck' && b.parent !== 'neck');
    expect(() => parseSkin(missing, null)).toThrow(/falta o osso "neck"/);
    const wrong = skinJson();
    wrong.bones.find((b) => b.name === 'hand_front')!.parent = 'torso';
    expect(() => parseSkin(wrong, null)).toThrow(/precisa ser filho de arm_front_fore/);
    expect(() => parseSkin(skinJson(), { width: 50, height: 50 })).toThrow(/fora da imagem/);
  });

  it('outra pose do mesmo personagem precisa dos mesmos ossos', () => {
    const expected = new Map(parseSkin(skinJson(), null).bones.map((b) => [b.name, b.parent]));
    const extra = skinJson();
    extra.bones.push({ name: 'tie_2', parent: 'tie_1', head: [140, 150], tail: [150, 170] });
    expect(() => parseSkin(extra, null, 'skin', expected)).toThrow(/não existe nas outras poses/);
  });
});

describe('skinToRig', () => {
  const spec = parseSkin(skinJson(), null);
  const rig = skinToRig(spec);
  const origin = spec.bones[0]!.head;

  it('no repouso, cada osso fica sobre a cabeça/cauda desenhada (raiz na origem)', () => {
    const s = new Skeleton(rig);
    spec.bones.forEach((b, i) => {
      const p = s.pivotWorld(i), d = s.endWorld(i);
      expect(p.x).toBeCloseTo(b.head.x - origin.x, 4);
      expect(p.y).toBeCloseTo(b.head.y - origin.y, 4);
      expect(d.x).toBeCloseTo(b.tail.x - origin.x, 4);
      expect(d.y).toBeCloseTo(b.tail.y - origin.y, 4);
    });
  });

  it('as matrizes de skinning do repouso são a identidade', () => {
    const s = new Skeleton(rig);
    const m = skinMatrices(s, invertAll(restMatrices(spec)));
    for (let b = 0; b < rig.bones.length; b++) {
      expect(m[b * 6]).toBeCloseTo(1, 5);
      expect(m[b * 6 + 1]).toBeCloseTo(0, 5);
      expect(m[b * 6 + 4]).toBeCloseTo(0, 4);
      expect(m[b * 6 + 5]).toBeCloseTo(0, 4);
    }
  });
});

describe('deformLBS', () => {
  // Imagem 60×20 cheia, dois ossos em linha: o da direita gira 90° em volta de x = 30.
  const w = 60, h = 20;
  const alpha = new Uint8ClampedArray(w * h).fill(255);
  const json = {
    char: 't', pose: 'p', image: 'x.png',
    bones: SKIN_BODY.map(([name, parent]) => ({ name, parent, head: [2, 10], tail: [4, 10] })),
  };
  json.bones[0] = { name: 'hips', parent: null, head: [0, 10], tail: [30, 10] };
  json.bones[1] = { name: 'torso', parent: 'hips', head: [30, 10], tail: [60, 10] };
  const spec = parseSkin(json, null);
  const rig = skinToRig(spec);
  const mesh = buildSkinMesh({ width: w, height: h, alpha, bones: spec.bones.map((b) => ({ head: b.head, tail: b.tail })), target: 120 });

  it('repouso devolve as posições originais', () => {
    const s = new Skeleton(rig);
    const out = deformLBS(mesh, skinMatrices(s, invertAll(restMatrices(spec))), spec.bones[0]!.head);
    for (let i = 0; i < mesh.vertexCount; i++) {
      expect(out[i * 2]! + spec.bones[0]!.head.x).toBeCloseTo(mesh.positions[i * 2]!, 3);
      expect(out[i * 2 + 1]! + spec.bones[0]!.head.y).toBeCloseTo(mesh.positions[i * 2 + 1]!, 3);
    }
  });

  it('girar um osso leva os vértices dele em volta da articulação', () => {
    const s = new Skeleton(rig);
    s.pose[1]!.rotation = Math.PI / 2;
    s.update();
    const out = deformLBS(mesh, skinMatrices(s, invertAll(restMatrices(spec))), spec.bones[0]!.head);
    // O vértice mais à direita (ponta, ~x 60) vai pra perto de (30, 40) na imagem → (0, 30) relativo à raiz.
    let far = 0;
    for (let i = 1; i < mesh.vertexCount; i++) if (mesh.positions[i * 2]! > mesh.positions[far * 2]!) far = i;
    expect(out[far * 2]! + 0).toBeLessThan(40);
    expect(out[far * 2 + 1]!).toBeGreaterThan(15);
  });
});

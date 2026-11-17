import { identity, type Mat2D, type Vec2 } from './math.js';
import type { SolvedBone, SolvedRig } from './rig.js';
import { Reader } from './validate.js';

/**
 * Pose-imagem (`assets/<pose>/<char>.skin.json`): a figura inteira de uma pose-chave, deformada
 * por um esqueleto desenhado sobre ela. Todas as poses de um personagem têm os mesmos ossos.
 *
 *   { "char": "<id>", "pose": "fly", "image": "fly.webp",
 *     "bones": [ { "name": "hips", "parent": null, "head": [x, y], "tail": [x, y], "limit": 12 }, … ],
 *     "chains": [ { "name": "coat", "bones": ["coat_tail_1", "coat_tail_2", "coat_tail_3"] } ],
 *     "mesh": { "target": 600, "boundaryStep": 7, "seed": 1 } }
 *
 * head/tail em px da imagem; `limit` em graus (quanto clipes e molas podem girar o osso).
 * `follow`: o osso copia a rotação de outro. Membros sobrepostos no desenho (as duas pernas juntas)
 * não podem se mexer separados sem esticar a imagem entre eles.
 */

/** Ossos do corpo obrigatórios em toda pose (nome → mãe). As correntes de tecido são livres. */
export const SKIN_BODY: ReadonlyArray<readonly [string, string | null]> = [
  ['hips', null],
  ['torso', 'hips'],
  ['neck', 'torso'],
  ['head', 'neck'],
  ['arm_front_upper', 'torso'],
  ['arm_front_fore', 'arm_front_upper'],
  ['hand_front', 'arm_front_fore'],
  ['arm_back_upper', 'torso'],
  ['arm_back_fore', 'arm_back_upper'],
  ['hand_back', 'arm_back_fore'],
  ['thigh_front', 'hips'],
  ['shin_front', 'thigh_front'],
  ['foot_front', 'shin_front'],
  ['thigh_back', 'hips'],
  ['shin_back', 'thigh_back'],
  ['foot_back', 'shin_back'],
];

export interface SkinBoneSpec {
  name: string;
  parent: string | null;
  head: Vec2;
  tail: Vec2;
  /** Limite de rotação (graus). */
  limit: number;
  /** Copia a rotação deste osso. */
  follow?: string;
}

export interface SkinSpec {
  char: string;
  pose: string;
  image: string;
  /** px do mundo por px da imagem (normalizado pela altura da cabeça; ver `measure`). */
  scale: number;
  /** Versão @2x da imagem (usada como textura quando DPR > 1,5); coordenadas sempre na 1x. */
  image2x?: string;
  /** Referência de escala: topo do cabelo e queixo (px da imagem 1x). */
  measure?: { headTop: Vec2; chin: Vec2 };
  bones: SkinBoneSpec[];
  chains: { name: string; bones: string[]; stiffness: number; damping: number }[];
  mesh: { target: number; boundaryStep: number; seed: number; clothTolerance: number };
}

/**
 * Valida a pose. `expected` = ossos (nome → mãe) de outra pose do mesmo personagem: a nova
 * precisa ter exatamente os mesmos, pra que clipes e molas valham em qualquer pose.
 */
export function parseSkin(json: unknown, size: { width: number; height: number } | null, source = 'skin', expected?: Map<string, string | null>): SkinSpec {
  const r = new Reader(source, json);
  r.object();
  const point = (p: Reader): Vec2 => {
    const [x, y] = p.pair();
    if (size && (x < -2 || y < -2 || x > size.width + 2 || y > size.height + 2)) p.fail(`ponto (${x}, ${y}) fora da imagem ${size.width}×${size.height}`);
    return { x, y };
  };
  const bones = r.at('bones').array().map((b) => ({
    name: b.at('name').string(),
    parent: b.at('parent').optString() ?? null,
    head: point(b.at('head')),
    tail: point(b.at('tail')),
    limit: b.at('limit').optNumber(12),
    ...(b.at('follow').present ? { follow: b.at('follow').string() } : {}),
  }));
  const byName = new Map(bones.map((b, i) => [b.name, i]));
  if (byName.size !== bones.length) r.at('bones').fail('nome de osso repetido');
  bones.forEach((b, i) => {
    if (b.parent !== null && !byName.has(b.parent)) r.at('bones').at(i).at('parent').fail(`mãe "${b.parent}" não existe`);
    if (b.parent !== null && byName.get(b.parent)! >= i) r.at('bones').at(i).at('parent').fail('a mãe precisa vir antes da filha na lista');
  });
  bones.forEach((b, i) => {
    if (b.follow !== undefined && (!byName.has(b.follow) || b.follow === b.name)) r.at('bones').at(i).at('follow').fail(`"${b.follow}" não é outro osso desta pose`);
  });
  for (const [name, parent] of SKIN_BODY) {
    const i = byName.get(name);
    if (i === undefined) r.at('bones').fail(`falta o osso "${name}"`);
    if (bones[i!]!.parent !== parent) r.at('bones').at(i!).at('parent').fail(`"${name}" precisa ser filho de ${parent ?? 'ninguém (raiz)'}`);
  }
  if (expected) {
    for (const [name, parent] of expected) {
      const i = byName.get(name);
      if (i === undefined) r.at('bones').fail(`falta o osso "${name}" (as poses de um personagem têm os mesmos ossos)`);
      if (bones[i!]!.parent !== parent) r.at('bones').at(i!).fail(`"${name}" tem outra mãe nas outras poses (${parent})`);
    }
    for (const b of bones) if (!expected.has(b.name)) r.at('bones').fail(`osso "${b.name}" não existe nas outras poses`);
  }
  const chains = r.at('chains').present
    ? r.at('chains').array().map((c) => ({
        name: c.at('name').string(),
        bones: c.at('bones').array().map((n) => {
          const name = n.string();
          if (!byName.has(name)) n.fail(`osso "${name}" não existe`);
          return name;
        }),
        stiffness: c.at('stiffness').optNumber(0.3),
        damping: c.at('damping').optNumber(0.2),
      }))
    : [];
  const m = r.at('mesh');
  return {
    char: r.at('char').string(),
    pose: r.at('pose').string(),
    image: r.at('image').string(),
    scale: r.at('scale').optNumber(1),
    ...(r.at('image2x').present ? { image2x: r.at('image2x').string() } : {}),
    ...(r.at('measure').present ? { measure: { headTop: point(r.at('measure').at('headTop')), chin: point(r.at('measure').at('chin')) } } : {}),
    bones,
    chains,
    mesh: {
      target: m.at('target').optNumber(600),
      boundaryStep: m.at('boundaryStep').optNumber(7),
      seed: m.at('seed').optNumber(1),
      clothTolerance: m.at('clothTolerance').optNumber(45),
    },
  };
}

/**
 * Rig equivalente ao de peças (o mesmo `Skeleton`, `Animator` e molas funcionam), sem peças.
 * A raiz fica na origem: a imagem é deslocada pra que a cabeça do osso raiz (quadril) caia em (0, 0).
 */
export function skinToRig(spec: SkinSpec): SolvedRig {
  const byName = new Map(spec.bones.map((b, i) => [b.name, i]));
  const origin = spec.bones.find((b) => b.parent === null)!.head;
  const bones: SolvedBone[] = spec.bones.map((b, index) => {
    const P = { x: b.head.x - origin.x, y: b.head.y - origin.y };
    const D = { x: b.tail.x - origin.x, y: b.tail.y - origin.y };
    return {
      index,
      name: b.name,
      parent: b.parent === null ? -1 : byName.get(b.parent)!,
      part: null,
      pivots: new Map(),
      // No espaço do osso, P = origem e D = a outra ponta, sem rotação própria do desenho.
      P: { x: 0, y: 0 },
      D: { x: Math.hypot(D.x - P.x, D.y - P.y), y: 0 },
      R: Math.atan2(D.y - P.y, D.x - P.x),
      rel: 0,
      T: P,
      layer: 'front',
      order: 0,
      scale: 1,
      stretch: identity(),
      slots: [],
      hidden: false,
      back: [],
      front: [],
    };
  });
  // Cabeças absolutas (raiz na origem), antes de virarem relativas à mãe.
  const heads = bones.map((b) => ({ ...b.T }));
  for (const b of bones) {
    if (b.parent < 0) continue;
    const p = bones[b.parent]!;
    b.rel = b.R - p.R;
    // Posição da cabeça no espaço da mãe (girado por R da mãe).
    const dx = heads[b.index]!.x - heads[p.index]!.x, dy = heads[b.index]!.y - heads[p.index]!.y;
    const c = Math.cos(-p.R), s = Math.sin(-p.R);
    p.front.push(b.index);
    b.T = { x: dx * c - dy * s, y: dx * s + dy * c };
  }
  const root = bones.find((b) => b.parent < 0)!;
  root.rel = root.R;
  root.T = { x: 0, y: 0 };
  // A escala da pose entra na raiz: o resto do esqueleto (e a imagem deformada) acompanha.
  root.scale = spec.scale;
  return {
    char: spec.char,
    kind: 'image',
    bones,
    roots: [root.index],
    caps: [],
    chains: spec.chains.map((c) => ({ ...c, bones: c.bones.map((n) => byName.get(n)!) })),
    byName,
  };
}

/** Matriz de repouso (mundo, raiz na origem) de cada osso de uma pose. */
export function restMatrices(spec: SkinSpec): Mat2D[] {
  const origin = spec.bones.find((b) => b.parent === null)!.head;
  // Bind em px da imagem (sem a escala): a matriz mundo × bind⁻¹ já leva a escala da raiz.
  return spec.bones.map((b) => {
    const a = Math.atan2(b.tail.y - b.head.y, b.tail.x - b.head.x);
    const c = Math.cos(a), s = Math.sin(a);
    return [c, s, -s, c, b.head.x - origin.x, b.head.y - origin.y];
  });
}

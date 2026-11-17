import { PartGeometry } from './geometry.js';
import { angleOf, deg2rad, dist, multiply, rotation, scaling, type Mat2D, type Vec2 } from './math.js';
import { Reader } from './validate.js';

/**
 * Formato do rig (`<char>.rig.json`), igual ao pose.json do reference/montar_personagem.py, mais
 * slots, caps e chains. Ângulos em graus (autoria); viram radianos ao resolver.
 *
 *  pivot  : "top" | "bottom" | "left" | "right"  → ponta do eixo comprido da peça (PCA), recuada
 *           { "bbox": [fx, fy] }                 → fração da caixa da peça
 *           { "xy": [x, y] }                     → coordenada exata na peça (px do recorte)
 *  attach : "end" | { "bbox": [fx, fy] } | { "xy": [x, y] }   → onde prende na mãe
 *  angle  : direção no mundo do eixo da peça (pivô → outra ponta). 0 = direita, 90 = baixo
 *  rotate : rotação aplicada ao desenho como ele está (cabeça, tronco, sapato)
 */
export type PointSpec = 'top' | 'bottom' | 'left' | 'right' | 'end' | { bbox: [number, number] } | { xy: [number, number] };

export interface BoneSpec {
  name: string;
  /** Peça padrão do osso (null = osso sem desenho, só articulação). */
  part: string | null;
  parent: string | null;
  pivot: PointSpec;
  attach: PointSpec;
  angle?: number;
  rotate?: number;
  inset?: number;
  layer: 'back' | 'front';
  order: number;
  /** Raiz: posição no espaço do personagem. */
  position: [number, number];
  scale: number;
  /** Alongar a peça ao longo do próprio eixo (PCA), sem engordar; as filhas acompanham o encaixe. */
  stretch: number;
  /** Peças trocáveis no mesmo osso (cabeças, mãos, olhos…). */
  slots: string[];
  /** Começa escondido (overlays de rosto). */
  hidden: boolean;
}

export interface CapSpec {
  name: string;
  part: string;
  bone: string;
  /** Na articulação do osso ("pivot") ou na outra ponta ("end"). */
  at: 'pivot' | 'end';
  scale: number;
}

export interface ChainSpec {
  name: string;
  bones: string[];
  stiffness: number;
  damping: number;
}

export interface RigSpec {
  char: string;
  tilt: number;
  bones: BoneSpec[];
  caps: CapSpec[];
  chains: ChainSpec[];
}

function readPoint(r: Reader, fallback: PointSpec): PointSpec {
  if (!r.present) return fallback;
  if (typeof r.value === 'string') return r.oneOf(['top', 'bottom', 'left', 'right', 'end'] as const);
  const o = r.object();
  if ('bbox' in o) return { bbox: r.at('bbox').pair() };
  if ('xy' in o) return { xy: r.at('xy').pair() };
  return r.fail('esperado "top"/"bottom"/"left"/"right"/"end", { "bbox": [fx, fy] } ou { "xy": [x, y] }');
}

/** Valida o rig contra as peças do atlas. */
export function parseRig(json: unknown, partNames: ReadonlySet<string>, source = 'rig'): RigSpec {
  const r = new Reader(source, json);
  r.object();
  const part = (p: Reader) => {
    const name = p.string();
    if (!partNames.has(name)) p.fail(`peça "${name}" não existe no atlas`);
    return name;
  };
  const bones = r.at('bones').array().map((b): BoneSpec => {
    const spec: BoneSpec = {
      name: b.at('name').string(),
      part: b.at('part').value === null ? null : part(b.at('part')),
      parent: b.at('parent').optString() ?? null,
      pivot: readPoint(b.at('pivot'), 'top'),
      attach: readPoint(b.at('attach'), 'end'),
      inset: b.at('inset').present ? b.at('inset').number() : undefined,
      layer: b.at('layer').oneOf(['back', 'front'] as const, 'front'),
      order: b.at('order').optNumber(0),
      position: b.at('position').present ? b.at('position').pair() : [0, 0],
      scale: b.at('scale').optNumber(1),
      stretch: b.at('stretch').optNumber(1),
      slots: b.at('slots').present ? b.at('slots').array().map(part) : [],
      hidden: b.at('hidden').present ? b.at('hidden').value === true : false,
    };
    if (b.at('angle').present && b.at('rotate').present) b.fail('use "angle" OU "rotate", não os dois');
    if (b.at('angle').present) spec.angle = b.at('angle').number();
    else spec.rotate = b.at('rotate').optNumber(0);
    if (spec.pivot === 'end') b.at('pivot').fail('"end" só vale para attach');
    if (spec.part === null && typeof spec.pivot === 'string') b.at('pivot').fail('osso sem peça precisa de pivot { "xy" }');
    return spec;
  });
  const names = new Map<string, number>();
  bones.forEach((b, i) => {
    if (names.has(b.name)) r.at('bones').at(i).at('name').fail(`osso "${b.name}" repetido`);
    names.set(b.name, i);
  });
  bones.forEach((b, i) => {
    if (b.parent !== null && !names.has(b.parent)) r.at('bones').at(i).at('parent').fail(`mãe "${b.parent}" não existe`);
  });
  // Ciclos: subir pelas mães nunca pode voltar ao mesmo osso.
  bones.forEach((b, i) => {
    const seen = new Set<string>();
    for (let cur: BoneSpec | undefined = b; cur?.parent; cur = bones[names.get(cur.parent)!]) {
      if (seen.has(cur.name)) r.at('bones').at(i).fail(`ciclo na hierarquia passando por "${cur.name}"`);
      seen.add(cur.name);
    }
  });
  if (!bones.some((b) => b.parent === null)) r.at('bones').fail('nenhum osso raiz (parent null)');
  const boneRef = (p: Reader) => {
    const name = p.string();
    if (!names.has(name)) p.fail(`osso "${name}" não existe`);
    return name;
  };
  const caps = r.at('caps').present
    ? r.at('caps').array().map((c) => ({
        name: c.at('name').string(),
        part: part(c.at('part')),
        bone: boneRef(c.at('bone')),
        at: c.at('at').oneOf(['pivot', 'end'] as const, 'pivot'),
        scale: c.at('scale').optNumber(1),
      }))
    : [];
  const chains = r.at('chains').present
    ? r.at('chains').array().map((c) => ({
        name: c.at('name').string(),
        bones: c.at('bones').array().map(boneRef),
        stiffness: c.at('stiffness').optNumber(0.5),
        damping: c.at('damping').optNumber(0.2),
      }))
    : [];
  return { char: r.at('char').string(), tilt: r.at('tilt').optNumber(0), bones, caps, chains };
}

/** Osso resolvido: tudo em radianos e px do espaço da peça. */
export interface SolvedBone {
  index: number;
  name: string;
  parent: number;
  part: string | null;
  /** Pivô (articulação) de cada peça possível do osso, no espaço da peça. */
  pivots: Map<string, Vec2>;
  /** Pivô e a outra ponta da peça padrão. */
  P: Vec2;
  D: Vec2;
  /** Rotação de repouso no mundo e relativa à mãe. */
  R: number;
  rel: number;
  /** Posição no espaço da mãe (relativa ao pivô da mãe, no desenho sem rotação da mãe). */
  T: Vec2;
  layer: 'back' | 'front';
  order: number;
  scale: number;
  /** Matriz (só 2×2) que alonga ao longo do eixo da peça; identidade se stretch = 1. */
  stretch: Mat2D;
  slots: string[];
  hidden: boolean;
  /** Filhos atrás e na frente da mãe, já na ordem de desenho. */
  back: number[];
  front: number[];
}

export interface SolvedCap {
  name: string;
  part: string;
  bone: number;
  /** Onde fica no espaço do osso (relativo ao pivô). */
  offset: Vec2;
  /** Centro da peça do cap (é desenhado centrado). */
  center: Vec2;
  scale: number;
}

export interface SolvedRig {
  char: string;
  /** "parts" = peças do atlas; "image" = pose-imagem deformada (sem peças nem slots). */
  kind?: 'parts' | 'image';
  bones: SolvedBone[];
  roots: number[];
  caps: SolvedCap[];
  chains: { name: string; bones: number[]; stiffness: number; damping: number }[];
  byName: Map<string, number>;
}

/** Escala `s` ao longo do eixo principal da peça (perpendicular fica igual). */
function axisStretch(geo: PartGeometry | null, s: number): Mat2D {
  if (!geo || s === 1) return [1, 0, 0, 1, 0, 0];
  const a = Math.atan2(geo.axis.y, geo.axis.x);
  return multiply(multiply(rotation(a), scaling(s, 1)), rotation(-a));
}

/** Pivô (P) e outra ponta (D) de uma peça para um `pivot`. */
export function pickPivot(spec: PointSpec, geo: PartGeometry, inset?: number): { P: Vec2; D: Vec2 } {
  const [a, b] = geo.joints(inset);
  if (typeof spec === 'string') {
    const key = { top: (p: Vec2) => p.y, bottom: (p: Vec2) => -p.y, left: (p: Vec2) => p.x, right: (p: Vec2) => -p.x }[spec as 'top'];
    return key(a) <= key(b) ? { P: a, D: b } : { P: b, D: a };
  }
  const P = 'bbox' in spec ? geo.bboxPoint(...spec.bbox) : { x: spec.xy[0], y: spec.xy[1] };
  return { P, D: dist(P, a) > dist(P, b) ? a : b };
}

function attachPoint(spec: PointSpec, parent: SolvedBone, parentGeo: PartGeometry | null): Vec2 {
  if (spec === 'end') return parent.D;
  if (typeof spec === 'string') throw new Error(`attach "${spec}" inválido (use "end", bbox ou xy)`);
  if ('xy' in spec) return { x: spec.xy[0], y: spec.xy[1] };
  if (!parentGeo) throw new Error(`a mãe "${parent.name}" não tem peça: use attach { "xy" }`);
  return parentGeo.bboxPoint(...spec.bbox);
}

/** Resolve o rig: pivôs, rotações e encaixes de cada osso (porte de `solve` do script de referência). */
export function solveRig(spec: RigSpec, geoOf: (part: string) => PartGeometry): SolvedRig {
  const tilt = deg2rad(spec.tilt);
  const byName = new Map(spec.bones.map((b, i) => [b.name, i]));
  const bones: SolvedBone[] = spec.bones.map((b, index) => {
    const geo = b.part ? geoOf(b.part) : null;
    let P: Vec2, D: Vec2;
    if (geo) ({ P, D } = pickPivot(b.pivot, geo, b.inset));
    else {
      const xy = (b.pivot as { xy: [number, number] }).xy;
      P = D = { x: xy[0], y: xy[1] };
    }
    const R = b.angle !== undefined ? deg2rad(b.angle) + tilt - angleOf(P, D) : deg2rad(b.rotate ?? 0) + tilt;
    const pivots = new Map<string, Vec2>();
    if (b.part) pivots.set(b.part, P);
    for (const slot of b.slots) if (!pivots.has(slot)) pivots.set(slot, pickPivot(b.pivot, geoOf(slot), b.inset).P);
    return {
      index,
      name: b.name,
      parent: b.parent === null ? -1 : byName.get(b.parent)!,
      part: b.part,
      pivots,
      P,
      D,
      R,
      rel: R,
      T: { x: b.position[0], y: b.position[1] },
      layer: b.layer,
      order: b.order,
      scale: b.scale,
      stretch: axisStretch(geo, b.stretch),
      slots: b.part && !b.slots.includes(b.part) ? [b.part, ...b.slots] : b.slots,
      hidden: b.hidden,
      back: [],
      front: [],
    };
  });
  for (const bone of bones) {
    if (bone.parent < 0) continue;
    const parent = bones[bone.parent]!;
    const A = attachPoint(spec.bones[bone.index]!.attach, parent, parent.part ? geoOf(parent.part) : null);
    bone.T = { x: A.x - parent.P.x, y: A.y - parent.P.y };
    bone.rel = bone.R - parent.R;
    (bone.layer === 'back' ? parent.back : parent.front).push(bone.index);
  }
  const byOrder = (a: number, b: number) => bones[a]!.order - bones[b]!.order || a - b;
  for (const bone of bones) {
    bone.back.sort(byOrder);
    bone.front.sort(byOrder);
  }
  const caps = spec.caps.map((c) => {
    const bone = bones[byName.get(c.bone)!]!;
    const g = geoOf(c.part);
    const at = c.at === 'end' ? { x: bone.D.x - bone.P.x, y: bone.D.y - bone.P.y } : { x: 0, y: 0 };
    return { name: c.name, part: c.part, bone: bone.index, offset: at, center: g.bboxPoint(0.5, 0.5), scale: c.scale };
  });
  return {
    char: spec.char,
    bones,
    roots: bones.filter((b) => b.parent < 0).sort((a, b) => byOrder(a.index, b.index)).map((b) => b.index),
    caps,
    chains: spec.chains.map((c) => ({ ...c, bones: c.bones.map((n) => byName.get(n)!) })),
    byName,
  };
}

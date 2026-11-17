import { apply, multiply, rotation, scaling, translation, type Mat2D, type Vec2 } from './math.js';
import type { SolvedRig } from './rig.js';

const xy = (p: Vec2): [number, number] => [p.x, p.y];

/** Ajuste de pose por osso, somado ao repouso do rig. */
export interface BonePose {
  /** Rotação extra (rad). */
  rotation: number;
  /** Deslocamento extra no espaço da mãe. */
  offset: Vec2;
  /** Escala extra. */
  scale: number;
  /** Peça mostrada (null = escondido). */
  slot: string | null;
}

export interface RootTransform {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  /** true = virado pra esquerda (espelhado na horizontal). */
  flip: boolean;
  /** Esticar (> 0) / achatar (< 0) ao longo de `stretchAngle` (rad, no mundo), preservando a área. */
  stretch: number;
  stretchAngle: number;
  /** Escala extra nos eixos do personagem (clipes: "sx"/"sy"). */
  sx: number;
  sy: number;
}

/** Um item da lista de desenho: peça do atlas e a matriz que leva o recorte ao mundo. */
export interface DrawItem {
  part: string;
  matrix: Mat2D;
  bone: number;
  cap?: string;
}

/** Instância de um rig: pose atual, transformações de mundo e ordem de desenho. */
export class Skeleton {
  readonly pose: BonePose[];
  readonly root: RootTransform = { x: 0, y: 0, rotation: 0, scale: 1, flip: false, stretch: 0, stretchAngle: 0, sx: 1, sy: 1 };
  /** Matriz de mundo de cada osso, com origem no pivô. */
  readonly world: Mat2D[];

  constructor(readonly rig: SolvedRig) {
    this.pose = rig.bones.map((b) => ({ rotation: 0, offset: { x: 0, y: 0 }, scale: 1, slot: b.hidden ? null : b.part }));
    this.world = rig.bones.map(() => [1, 0, 0, 1, 0, 0] as Mat2D);
    this.update();
  }

  bone(name: string): number {
    const i = this.rig.byName.get(name);
    if (i === undefined) throw new Error(`osso "${name}" não existe no rig ${this.rig.char}`);
    return i;
  }

  /** Cópia congelada (rastro/borrão: a pose que sai continua desenhável). */
  clone(): Skeleton {
    const c = new Skeleton(this.rig);
    this.pose.forEach((p, i) => Object.assign(c.pose[i]!, { ...p, offset: { ...p.offset } }));
    Object.assign(c.root, this.root);
    c.update();
    return c;
  }

  resetPose(): void {
    this.rig.bones.forEach((b, i) => {
      const p = this.pose[i]!;
      p.rotation = 0;
      p.offset = { x: 0, y: 0 };
      p.scale = 1;
      p.slot = b.hidden ? null : b.part;
    });
  }

  rootMatrix(): Mat2D {
    const r = this.root;
    let m = translation(r.x, r.y);
    if (r.stretch) {
      const s = 1 + r.stretch;
      m = multiply(multiply(multiply(m, rotation(r.stretchAngle)), scaling(s, 1 / s)), rotation(-r.stretchAngle));
    }
    m = multiply(m, scaling(r.flip ? -r.scale : r.scale, r.scale));
    m = multiply(m, rotation(r.rotation));
    if (r.sx !== 1 || r.sy !== 1) m = multiply(m, scaling(r.sx, r.sy));
    return m;
  }

  /** Recalcula as matrizes de mundo (mãe antes das filhas). */
  update(): void {
    const rootM = this.rootMatrix();
    const visit = (i: number, parentM: Mat2D) => {
      const b = this.rig.bones[i]!;
      const p = this.pose[i]!;
      // O encaixe na mãe acompanha o alongamento dela.
      const T = b.parent >= 0 ? apply(this.rig.bones[b.parent]!.stretch, b.T) : b.T;
      const local = multiply(
        multiply(translation(T.x + p.offset.x, T.y + p.offset.y), rotation(b.rel + p.rotation)),
        scaling(b.scale * p.scale),
      );
      const m = multiply(parentM, local);
      this.world[i] = m;
      for (const c of b.back) visit(c, m);
      for (const c of b.front) visit(c, m);
    };
    for (const r of this.rig.roots) visit(r, rootM);
  }

  /** Posição no mundo do pivô (articulação) de um osso. */
  pivotWorld(i: number): Vec2 {
    return apply(this.world[i]!, { x: 0, y: 0 });
  }

  /** Posição no mundo da outra ponta da peça padrão do osso. */
  endWorld(i: number): Vec2 {
    const b = this.rig.bones[i]!;
    return apply(multiply(this.world[i]!, b.stretch), { x: b.D.x - b.P.x, y: b.D.y - b.P.y });
  }

  /**
   * Ordem de desenho: para cada osso, filhos de trás, a peça, filhos da frente. Cada cap entra
   * logo depois do que vier por último entre a peça do osso e a da mãe (cobre a emenda das duas).
   */
  drawList(): DrawItem[] {
    const list: DrawItem[] = [];
    const artIndex = new Map<number, number>();
    const visit = (i: number) => {
      const b = this.rig.bones[i]!;
      for (const c of b.back) visit(c);
      const slot = this.pose[i]!.slot;
      if (slot) {
        const P = b.pivots.get(slot) ?? b.P;
        artIndex.set(i, list.length);
        list.push({ part: slot, matrix: multiply(multiply(this.world[i]!, b.stretch), translation(-P.x, -P.y)), bone: i });
      }
      for (const c of b.front) visit(c);
    };
    for (const r of this.rig.roots) visit(r);
    const inserts = this.rig.caps.map((cap) => {
      const parent = this.rig.bones[cap.bone]!.parent;
      const after = Math.max(artIndex.get(cap.bone) ?? -1, parent >= 0 ? (artIndex.get(parent) ?? -1) : -1);
      const matrix = multiply(
        multiply(multiply(this.world[cap.bone]!, translation(...xy(apply(this.rig.bones[cap.bone]!.stretch, cap.offset)))), scaling(cap.scale)),
        translation(-cap.center.x, -cap.center.y),
      );
      return { at: after + 1, item: { part: cap.part, matrix, bone: cap.bone, cap: cap.name } };
    });
    inserts.sort((a, b) => b.at - a.at);
    for (const { at, item } of inserts) list.splice(at, 0, item);
    return list;
  }
}

import type { Vec2 } from './math.js';

/** Caixa alinhada aos eixos. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Geometria de uma peça: caixa, eixo principal (PCA) e as duas pontas.
 * Porte de `Geo` do reference/montar_personagem.py, aqui sobre os pixels opacos da peça
 * (em vez do contorno do SVG). Coordenadas no espaço da peça (px do recorte).
 */
export class PartGeometry {
  readonly box: Box;
  readonly center: Vec2;
  /** Eixo comprido (unitário) e o transversal. */
  readonly axis: Vec2;
  readonly normal: Vec2;
  readonly length: number;
  readonly width: number;
  /** Pontas do eixo em coordenadas (t, u) do eixo. */
  private readonly ends: [{ t: number; u: number }, { t: number; u: number }];

  constructor(points: ArrayLike<number>) {
    const n = points.length / 2;
    if (n < 3) throw new Error('peça sem pixels suficientes para medir');
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, mx = 0, my = 0;
    for (let i = 0; i < n; i++) {
      const x = points[i * 2]!, y = points[i * 2 + 1]!;
      mx += x;
      my += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    mx /= n;
    my /= n;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const dx = points[i * 2]! - mx, dy = points[i * 2 + 1]! - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ax = Math.cos(th), ay = Math.sin(th);
    const px = -ay, py = ax;
    const ts = new Float64Array(n), us = new Float64Array(n);
    let tmin = Infinity, tmax = -Infinity, umin = Infinity, umax = -Infinity;
    for (let i = 0; i < n; i++) {
      const dx = points[i * 2]! - mx, dy = points[i * 2 + 1]! - my;
      const t = dx * ax + dy * ay, u = dx * px + dy * py;
      ts[i] = t;
      us[i] = u;
      if (t < tmin) tmin = t;
      if (t > tmax) tmax = t;
      if (u < umin) umin = u;
      if (u > umax) umax = u;
    }
    // Os pontos são centros de pixel: a caixa vai da borda do primeiro à do último.
    this.box = { x0: x0 - 0.5, y0: y0 - 0.5, x1: x1 + 0.5, y1: y1 + 0.5 };
    this.center = { x: mx, y: my };
    this.axis = { x: ax, y: ay };
    this.normal = { x: px, y: py };
    this.length = tmax - tmin;
    this.width = umax - umin;
    // Em cada ponta, o meio (mediana de u) dos pixels perto dela: a ponta "de verdade" da peça.
    const end = (tt: number) => {
      const near: number[] = [];
      for (let i = 0; i < n; i++) if (Math.abs(ts[i]! - tt) < 0.12 * this.length) near.push(us[i]!);
      near.sort((a, b) => a - b);
      return { t: tt, u: near.length ? near[near.length >> 1]! : 0 };
    };
    this.ends = [end(tmin), end(tmax)];
  }

  toXY(t: number, u: number): Vec2 {
    return { x: this.center.x + this.axis.x * t + this.normal.x * u, y: this.center.y + this.axis.y * t + this.normal.y * u };
  }

  /** As duas articulações: as pontas recuadas pra dentro da peça (`inset` = fração do comprimento). */
  joints(inset?: number): [Vec2, Vec2] {
    const ins = inset === undefined ? Math.min(0.45 * this.width, 0.25 * this.length) : inset * this.length;
    const [a, b] = this.ends;
    return [this.toXY(a.t + ins, a.u), this.toXY(b.t - ins, b.u)];
  }

  bboxPoint(fx: number, fy: number): Vec2 {
    const { x0, y0, x1, y1 } = this.box;
    return { x: x0 + fx * (x1 - x0), y: y0 + fy * (y1 - y0) };
  }
}

/** Coordenadas (x, y intercalados) dos pixels com alfa >= `threshold`. `step` > 1 amostra. */
export function opaquePoints(alpha: ArrayLike<number>, width: number, height: number, threshold = 128, step = 1): Float32Array {
  const out: number[] = [];
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) if (alpha[y * width + x]! >= threshold) out.push(x + 0.5, y + 0.5);
  return Float32Array.from(out);
}

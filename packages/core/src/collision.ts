import type { Vec2 } from './math.js';

/** Cápsula: segmento a–b com raio r (um círculo é a = b). Coordenadas do mundo. */
export interface Capsule {
  a: Vec2;
  b: Vec2;
  r: number;
}

export interface Contact {
  /** Ponto do contato (no meio da sobreposição). */
  point: Vec2;
  /** Quanto as formas se sobrepõem (px, > 0). */
  depth: number;
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Ponto do segmento a–b mais próximo de p. */
export function closestOnSegment(a: Vec2, b: Vec2, p: Vec2): Vec2 {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2) : 0;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/** Par de pontos mais próximos entre os segmentos p1–q1 e p2–q2 (Ericson, Real-Time Collision Detection 5.1.9). */
export function closestSegmentSegment(p1: Vec2, q1: Vec2, p2: Vec2, q2: Vec2): [Vec2, Vec2] {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y };
  const d2 = { x: q2.x - p2.x, y: q2.y - p2.y };
  const r = { x: p1.x - p2.x, y: p1.y - p2.y };
  const a = d1.x * d1.x + d1.y * d1.y;
  const e = d2.x * d2.x + d2.y * d2.y;
  const f = d2.x * r.x + d2.y * r.y;
  const EPS = 1e-9;
  let s: number, t: number;
  if (a <= EPS && e <= EPS) return [p1, p2];
  if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1.x * r.x + d1.y * r.y;
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1.x * d2.x + d1.y * d2.y;
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  return [
    { x: p1.x + d1.x * s, y: p1.y + d1.y * s },
    { x: p2.x + d2.x * t, y: p2.y + d2.y * t },
  ];
}

/** Cápsula × cápsula (círculos são cápsulas com a = b). null = não encostam. */
export function capsuleHit(c1: Capsule, c2: Capsule): Contact | null {
  const [p, q] = closestSegmentSegment(c1.a, c1.b, c2.a, c2.b);
  const d = Math.hypot(q.x - p.x, q.y - p.y);
  const depth = c1.r + c2.r - d;
  if (depth <= 0) return null;
  // Ponto de contato: entre as duas superfícies, na linha dos centros mais próximos.
  const k = d > 0 ? (c1.r - depth / 2) / d : 0;
  return { point: { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k }, depth };
}

export const circle = (center: Vec2, r: number): Capsule => ({ a: center, b: center, r });

/** Retângulo alinhado aos eixos (props: porta, parede). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Cápsula × caixa (aproximação: ponto da cápsula mais perto do centro da caixa, testado contra a caixa). */
export function capsuleBoxHit(c: Capsule, box: Box): Contact | null {
  const clampTo = (p: Vec2): Vec2 => ({ x: Math.max(box.x, Math.min(box.x + box.w, p.x)), y: Math.max(box.y, Math.min(box.y + box.h, p.y)) });
  // Amostra o segmento (as cápsulas dos ossos são curtas; 8 amostras bastam).
  let best: Contact | null = null;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const p = { x: c.a.x + (c.b.x - c.a.x) * t, y: c.a.y + (c.b.y - c.a.y) * t };
    const q = clampTo(p);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    const inside = d === 0;
    const depth = inside ? c.r + Math.min(p.x - box.x, box.x + box.w - p.x, p.y - box.y, box.y + box.h - p.y) : c.r - d;
    if (depth > 0 && (!best || depth > best.depth)) best = { point: q, depth };
  }
  return best;
}

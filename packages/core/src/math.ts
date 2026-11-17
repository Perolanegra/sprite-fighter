/** Ponto/vetor 2D. */
export interface Vec2 {
  x: number;
  y: number;
}

export const DEG = Math.PI / 180;
export const deg2rad = (d: number) => d * DEG;
export const rad2deg = (r: number) => r / DEG;

/** Ângulo normalizado em (-π, π]. */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/**
 * Matriz afim 2D na ordem do canvas: [a, b, c, d, e, f] ↔
 *   | a c e |
 *   | b d f |
 */
export type Mat2D = [number, number, number, number, number, number];

export const identity = (): Mat2D => [1, 0, 0, 1, 0, 0];

/** m × n (aplica n primeiro, depois m). */
export function multiply(m: Mat2D, n: Mat2D): Mat2D {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const translation = (x: number, y: number): Mat2D => [1, 0, 0, 1, x, y];
export const rotation = (a: number): Mat2D => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, -s, c, 0, 0];
};
export const scaling = (sx: number, sy = sx): Mat2D => [sx, 0, 0, sy, 0, 0];

export function apply(m: Mat2D, p: Vec2): Vec2 {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invert(m: Mat2D): Mat2D {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) throw new Error('matriz não inversível');
  const i = 1 / det;
  return [m[3] * i, -m[1] * i, -m[2] * i, m[0] * i, (m[2] * m[5] - m[3] * m[4]) * i, (m[1] * m[4] - m[0] * m[5]) * i];
}

/** Rotação da matriz (ângulo do eixo x transformado). */
export const matrixAngle = (m: Mat2D) => Math.atan2(m[1], m[0]);

export const dist = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);
export const angleOf = (a: Vec2, b: Vec2) => Math.atan2(b.y - a.y, b.x - a.x);

import type { Vec2 } from './math.js';
import type { PropOpening } from './props.js';

/**
 * Geometria da passagem por uma abertura (`enter`/`exit`), pura. O plano da passagem fica no meio
 * da caixa da abertura, ao longo do eixo; `side` é o lado visível (-1 = antes do plano, no sentido
 * negativo do eixo; 1 = depois). Tudo o que passa para o outro lado, dentro do vão, é recortado.
 */
export interface PassPlan {
  axis: 'x' | 'y';
  /** Coordenada do plano no eixo da passagem. */
  plane: number;
  /** Lado visível do plano. */
  side: 1 | -1;
  /** Vão da abertura no eixo transversal [mín, máx]. */
  span: [number, number];
}

const along = (axis: 'x' | 'y', p: Vec2) => (axis === 'x' ? p.x : p.y);
const across = (axis: 'x' | 'y', p: Vec2) => (axis === 'x' ? p.y : p.x);
const point = (axis: 'x' | 'y', a: number, c: number): Vec2 => (axis === 'x' ? { x: a, y: c } : { x: c, y: a });

/** Plano da abertura, com o lado visível dado por um ponto desse lado (sobre o plano: `fallback`). */
export function passPlan(opening: PropOpening, visible: Vec2, fallback: 1 | -1 = -1): PassPlan {
  const { box: b, axis } = opening;
  const plane = axis === 'x' ? b.x + b.w / 2 : b.y + b.h / 2;
  const d = along(axis, visible) - plane;
  return { axis, plane, side: d > 0 ? 1 : d < 0 ? -1 : fallback, span: axis === 'x' ? [b.y, b.y + b.h] : [b.x, b.x + b.w] };
}

/** Distância (px) de um ponto ao plano, positiva do lado visível. */
export function sideDistance(plan: PassPlan, p: Vec2): number {
  return (along(plan.axis, p) - plan.plane) * plan.side;
}

/** Ponto a `depth` px do plano (positivo = lado visível), no meio do vão. */
export function planePoint(plan: PassPlan, depth: number): Vec2 {
  return point(plan.axis, plan.plane + depth * plan.side, (plan.span[0] + plan.span[1]) / 2);
}

/** Região escondida (4 cantos, mundo): o lado de trás do plano, na altura do vão. */
export function hiddenQuad(plan: PassPlan, far = 1e5): Vec2[] {
  const back = plan.plane - far * plan.side;
  const [c0, c1] = plan.span;
  return [point(plan.axis, plan.plane, c0), point(plan.axis, back, c0), point(plan.axis, back, c1), point(plan.axis, plan.plane, c1)];
}

/**
 * Quanto um ponto fica fora do vão, no eixo transversal (px): 0 = dentro; negativo = antes do
 * começo do vão (acima de uma porta, à esquerda de um alçapão); positivo = depois do fim.
 */
export function spanMiss(plan: PassPlan, p: Vec2): number {
  const c = across(plan.axis, p);
  return c < plan.span[0] ? c - plan.span[0] : c > plan.span[1] ? c - plan.span[1] : 0;
}

/** Escala (fração da atual) que faz um corpo de `extent` px caber em 90 % do vão. */
export function fitScale(plan: PassPlan, extent: number): number {
  return extent > 0 ? (0.9 * (plan.span[1] - plan.span[0])) / extent : 1;
}

/** Peso da flutuação perto do plano: 0 no plano, 1 a partir de `reach` px do lado visível. */
export function hoverNear(distance: number, reach: number): number {
  const k = Math.max(0, Math.min(1, distance / Math.max(1, reach)));
  return k * k * (3 - 2 * k);
}

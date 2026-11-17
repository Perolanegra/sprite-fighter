import { angleOf, apply, dist, wrapAngle, type Vec2 } from './math.js';
import type { Skeleton } from './skeleton.js';

/*
 * Camada procedural: somada depois dos clipes, a cada passo fixo. Tudo trabalha com ângulos no
 * mundo; ao converter para a rotação do osso, o sinal inverte quando o personagem está espelhado.
 */

const localSign = (s: Skeleton) => (s.root.flip ? -1 : 1);

/** Gira o osso `i` em `worldDelta` rad (no mundo). */
export function rotateWorld(s: Skeleton, i: number, worldDelta: number): void {
  s.pose[i]!.rotation += worldDelta * localSign(s);
}

// --- Molas (tecido) ---------------------------------------------------------

export interface SpringOptions {
  /** 0..1: quanto o tecido volta rápido pra pose do clipe. */
  stiffness: number;
  /** 0..1: quanto o balanço perde energia. */
  damping: number;
  /** Ângulo máximo de desvio (rad). */
  limit: number;
}

/**
 * Corrente de molas: a ponta de cada osso é uma massa presa à posição que o clipe pede. Quando o
 * corpo acelera, a ponta fica pra trás (o tecido "arrasta"); quando freia, passa do ponto e assenta.
 */
export class SpringChain {
  private tips: Vec2[] | null = null;
  private vels: Vec2[] = [];

  constructor(
    readonly bones: number[],
    readonly options: SpringOptions,
  ) {}

  reset(): void {
    this.tips = null;
  }

  step(s: Skeleton, dt: number): void {
    const k = 30 + this.options.stiffness * 400;
    const c = 2 + this.options.damping * 30;
    if (!this.tips) {
      this.tips = this.bones.map((b) => s.endWorld(b));
      this.vels = this.bones.map(() => ({ x: 0, y: 0 }));
    }
    this.bones.forEach((b, n) => {
      const pivot = s.pivotWorld(b);
      const target = s.endWorld(b);
      const len = dist(pivot, target);
      const tip = this.tips![n]!;
      const v = this.vels[n]!;
      v.x += (k * (target.x - tip.x) - c * v.x) * dt;
      v.y += (k * (target.y - tip.y) - c * v.y) * dt;
      tip.x += v.x * dt;
      tip.y += v.y * dt;
      // O tecido não estica: a ponta fica a `len` do pivô.
      const d = dist(pivot, tip) || 1;
      tip.x = pivot.x + ((tip.x - pivot.x) / d) * len;
      tip.y = pivot.y + ((tip.y - pivot.y) / d) * len;
      let delta = wrapAngle(angleOf(pivot, tip) - angleOf(pivot, target));
      delta = Math.max(-this.options.limit, Math.min(this.options.limit, delta));
      rotateWorld(s, b, delta);
      s.update();
    });
  }
}

// --- IK de 2 ossos ----------------------------------------------------------

/**
 * Ângulos no mundo de dois ossos (comprimentos l1, l2) saindo de `origin` para alcançar `target`
 * (ou esticar na direção dele, se estiver longe). `bend` = 1 ou -1 escolhe o lado do cotovelo.
 */
export function solveTwoBone(origin: Vec2, l1: number, l2: number, target: Vec2, bend: 1 | -1): { upper: number; lower: number } {
  const base = angleOf(origin, target);
  const d = Math.min(dist(origin, target), l1 + l2 - 1e-6);
  const dd = Math.max(d, Math.abs(l1 - l2) + 1e-6);
  const cosA = (l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd);
  const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const upper = base - bend * a;
  const elbow = { x: origin.x + Math.cos(upper) * l1, y: origin.y + Math.sin(upper) * l1 };
  const reach = { x: origin.x + Math.cos(base) * dd, y: origin.y + Math.sin(base) * dd };
  return { upper, lower: angleOf(elbow, reach) };
}

/** Mira um braço/perna (osso de cima + de baixo) num alvo do mundo, com `weight` 0..1. */
export function aimTwoBone(s: Skeleton, upper: number, lower: number, target: Vec2, bend: 1 | -1, weight = 1): void {
  const S = s.pivotWorld(upper);
  const E = s.pivotWorld(lower);
  const W = s.endWorld(lower);
  const solved = solveTwoBone(S, dist(S, E), dist(E, W), target, s.root.flip ? (-bend as 1 | -1) : bend);
  const d1 = wrapAngle(solved.upper - angleOf(S, E)) * weight;
  const d2 = wrapAngle(solved.lower - angleOf(E, W)) * weight;
  rotateWorld(s, upper, d1);
  rotateWorld(s, lower, d2 - d1); // a de baixo já girou junto com a de cima
  s.update();
}

// --- Olhar ------------------------------------------------------------------

/** Gira o osso (cabeça) pra olhar o alvo: o eixo +x local aponta pra ele, até `limit` rad. */
export function lookAt(s: Skeleton, bone: number, target: Vec2, limit: number, weight = 1): void {
  const pivot = s.pivotWorld(bone);
  const forward = angleOf(pivot, apply(s.world[bone]!, { x: 1, y: 0 }));
  const delta = Math.max(-limit, Math.min(limit, wrapAngle(angleOf(pivot, target) - forward)));
  rotateWorld(s, bone, delta * weight);
  s.update();
}

// --- Flutuar / respirar -----------------------------------------------------

/** Deslocamento de flutuação (seno) no tempo `t` s: sobe e desce, com um leve balanço. */
export function hover(t: number, amplitude = 6, period = 1.6): { y: number; rot: number } {
  const ph = (2 * Math.PI * t) / period;
  return { y: Math.sin(ph) * amplitude, rot: Math.sin(ph - 0.6) * 0.02 };
}

// --- Squash & stretch -------------------------------------------------------

/**
 * Esticar/achatar pela aceleração ao longo da velocidade: arrancar estica, frear achata.
 * Suavizado (segue o alvo como mola crítica). Valores pequenos (±0,12).
 */
export class SquashStretch {
  amount = 0;
  angle = 0;
  private vel = 0;

  constructor(
    readonly gain = 0.00006,
    readonly max = 0.12,
  ) {}

  step(velocity: Vec2, accel: Vec2, dt: number): void {
    const speed = Math.hypot(velocity.x, velocity.y);
    let target = 0;
    if (speed > 1) {
      const along = (accel.x * velocity.x + accel.y * velocity.y) / speed;
      target = Math.max(-this.max, Math.min(this.max, along * this.gain));
      this.angle = Math.atan2(velocity.y, velocity.x);
    }
    // Mola criticamente amortecida até o alvo (sem tremer).
    const w = 28;
    this.vel += (w * w * (target - this.amount) - 2 * w * this.vel) * dt;
    this.amount += this.vel * dt;
  }
}

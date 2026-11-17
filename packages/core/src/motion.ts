import { ease, type EaseName } from './easing.js';
import type { Vec2 } from './math.js';
import { Route } from './route.js';

/** O que um controlador de movimento mexe: posição (lida), velocidade e escala (escritas). */
export interface Body {
  position: Vec2;
  velocity: Vec2;
  scale: number;
}

/**
 * Movimento dirigido. A cada passo define a **velocidade** do corpo (não teleporta a posição):
 * assim molas, squash e inclinação do tronco reagem ao movimento. Devolve true quando terminou.
 */
export interface Motion {
  readonly kind: string;
  /** Deixar rastro (afterimage, Fase 5). */
  readonly trail?: boolean;
  step(body: Body, dt: number): boolean;
}

/**
 * Vai até um ponto (ou percorre uma rota) em `duration` s, com easing. A velocidade de cada passo é
 * (ponto da rota agora − ponto do passo anterior) / dt: sem nada somado, termina exatamente no
 * destino; um deslocamento extra (esquiva) se soma em vez de ser desfeito. `scaleTo` muda a
 * escala junto (profundidade: menor = mais longe).
 */
export class MoveTo implements Motion {
  readonly kind = 'moveTo';
  private t = 0;
  private from: Vec2 | null = null;
  private last: Vec2 = { x: 0, y: 0 };
  private scaleFrom = 1;
  private readonly route: Route | null;

  constructor(
    private readonly params: { to?: Vec2; route?: string | Route; duration: number; ease?: EaseName; scaleTo?: number },
  ) {
    if (!params.to && !params.route) throw new Error('moveTo: informe "to" ou "route"');
    if (!(params.duration > 0)) throw new Error('moveTo: "duration" precisa ser > 0');
    this.route = params.route === undefined ? null : typeof params.route === 'string' ? new Route(params.route) : params.route;
  }

  private at(u: number): Vec2 {
    if (this.route) return this.route.point(u);
    const to = this.params.to!;
    return { x: this.from!.x + (to.x - this.from!.x) * u, y: this.from!.y + (to.y - this.from!.y) * u };
  }

  step(body: Body, dt: number): boolean {
    if (!this.from) {
      this.from = { ...body.position };
      this.last = { ...body.position };
      this.scaleFrom = body.scale;
    }
    this.t = Math.min(this.params.duration, this.t + dt);
    const k = this.t / this.params.duration;
    // Easing sem clamp no meio (overshoot do backOut vale), mas a rota é amostrada dentro de [0, 1].
    const e = ease(this.params.ease ?? 'sineInOut', k);
    const target = this.at(e);
    body.velocity.x = (target.x - this.last.x) / dt;
    body.velocity.y = (target.y - this.last.y) / dt;
    this.last = target;
    if (this.params.scaleTo !== undefined) body.scale = this.scaleFrom + (this.params.scaleTo - this.scaleFrom) * e;
    // Tolerância: a soma de passos fixos (n × dt) fica um tiquinho abaixo da duração.
    return this.t >= this.params.duration - 1e-9;
  }
}

/** Impulso com arrasto exponencial (dash, avanço de golpe, recuo de knockback). */
export class Impulse implements Motion {
  private t = 0;
  private readonly v: Vec2;

  constructor(
    velocity: Vec2,
    private readonly params: { drag?: number; duration?: number; kind?: string; trail?: boolean } = {},
  ) {
    this.v = { ...velocity };
    this.kind = params.kind ?? 'impulse';
    this.trail = params.trail ?? false;
  }
  readonly kind: string;
  readonly trail: boolean;

  step(body: Body, dt: number): boolean {
    this.t += dt;
    const decay = Math.exp(-(this.params.drag ?? 6) * dt);
    this.v.x *= decay;
    this.v.y *= decay;
    body.velocity.x = this.v.x;
    body.velocity.y = this.v.y;
    if (this.params.duration !== undefined) return this.t >= this.params.duration;
    return Math.hypot(this.v.x, this.v.y) < 15;
  }
}

export const dash = (velocity: Vec2, params: { drag?: number; duration?: number } = {}) => new Impulse(velocity, { drag: 5, ...params, kind: 'dash', trail: true });
export const knockback = (velocity: Vec2, drag = 4) => new Impulse(velocity, { drag, kind: 'knockback' });

/** Flutua parado (a flutuação em seno do Actor continua; aqui só zera a velocidade). */
export class Hover implements Motion {
  readonly kind = 'hover';
  step(body: Body): boolean {
    body.velocity.x = 0;
    body.velocity.y = 0;
    return false;
  }
}

/** Queda com gravidade (px/s²), até a velocidade terminal. Não termina sozinha. */
export class Fall implements Motion {
  readonly kind = 'fall';
  private vy: number;
  constructor(
    private readonly vx = 0,
    vy = 0,
    private readonly gravity = 2600,
    private readonly terminal = 1600,
  ) {
    this.vy = vy;
  }
  step(body: Body, dt: number): boolean {
    this.vy = Math.min(this.terminal, this.vy + this.gravity * dt);
    body.velocity.x = this.vx;
    body.velocity.y = this.vy;
    return false;
  }
}

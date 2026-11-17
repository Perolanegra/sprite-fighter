import type { Actor, AfterimageOptions } from './actor.js';
import type { ImpactOptions, SparkOptions, SpeedLineOptions } from './fx.js';
import type { Vec2 } from './math.js';
import type { FxSpec } from './move.js';
import type { Fighter, World } from './world.js';

/** Efeitos que uma ação (ou o roteiro) pode pedir. Aceitam o Fighter ou o Actor dele. */
export interface FxApi {
  /** Borrão de `frames` quadros entre a pose anterior e a atual, esticado no sentido da velocidade. */
  smear(who: Fighter | Actor, frames?: number): void;
  /** Cópias translúcidas (rastro). */
  afterimage(who: Fighter | Actor, options?: AfterimageOptions): void;
  /** Silhueta pintada (impacto). */
  flash(who: Fighter | Actor, frames?: number, color?: string): void;
  impact(at: Vec2, options?: ImpactOptions): void;
  spark(at: Vec2, options?: SparkOptions): void;
  speedLines(options?: SpeedLineOptions): void;
  /** Efeito por nome/tipo (os mesmos do JSON dos golpes). */
  emit(type: string, at?: Vec2, params?: Record<string, unknown>): void;
  run(spec: FxSpec | string, on?: Fighter | Actor): void;
}

export interface CameraApi {
  shake(amount: number): void;
  zoom(value: number | null, seconds?: number): void;
  pan(x: number, y: number, seconds?: number): void;
  follow(id: string): void;
  auto(): void;
}

export interface ActionContext {
  self: Fighter;
  target: Fighter | null;
  fx: FxApi;
  camera: CameraApi;
  scene: World;
  /** RNG com semente do World (determinístico). */
  rng: () => number;
  /** Parâmetros da fase (`"run": { "action": "<nome>", "params": { … } }`); vazio com `"run": "<nome>"`. */
  params: Record<string, unknown>;
}

export type ActionFn = (ctx: ActionContext) => void;

const registry = new Map<string, ActionFn>();

/** Registra uma ação TS, referenciada pelo nome no `run` de uma fase de golpe. */
export function registerAction(name: string, fn: ActionFn): void {
  registry.set(name, fn);
}

export function getAction(name: string): ActionFn | undefined {
  return registry.get(name);
}

export const hasAction = (name: string) => registry.has(name);

/** Nomes das ações registradas (o catálogo do narrador lista). */
export const actionNames = () => [...registry.keys()];

// Embutidas.
registerAction('teleport_behind', ({ self, target, fx }) => {
  if (!target) return;
  fx.afterimage(self, { life: 14 });
  const t = target.actor;
  self.actor.position = { x: t.position.x - 120 * t.facing * t.scale, y: t.position.y };
  self.actor.face(t);
});

registerAction('vanish', ({ self, fx }) => {
  fx.afterimage(self);
  self.actor.opacity = 0;
});

registerAction('appear', ({ self, fx }) => {
  self.actor.opacity = 1;
  self.actor.smear(3);
  fx.emit('muzzle', self.center(), { size: 0.8 });
});

import type { PoseTransition } from './character.js';
import type { EaseName } from './easing.js';
import { COMMANDS, parseScript, type Script } from './script.js';

/** Um passo no formato JSON do roteiro. */
export interface StepJson {
  id?: string;
  at?: number;
  after?: string;
  on?: string;
  nth?: number;
  delay?: number;
  actor?: string;
  do: string;
  params?: Record<string, unknown>;
}

export interface CastJson {
  at?: [number, number];
  scale?: number;
  facing?: 1 | -1;
  pose?: string;
  clip?: string;
  opacity?: number;
  collideProps?: boolean;
}

export interface ScriptJson {
  title?: string;
  seed?: number;
  duration?: number;
  tail?: number;
  cast?: Record<string, CastJson>;
  camera?: Record<string, unknown>;
  steps: StepJson[];
}

type Xy = [number, number];
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Comandos comuns ao roteiro e ao `parallel`: cada um vira um passo `{ actor, do, params }`. */
abstract class StepWriter<T extends StepWriter<T>> {
  protected currentActor: string | null = null;
  protected abstract push(step: StepJson): void;
  protected abstract self(): T;

  /** Ator dos próximos comandos (id do elenco; null = nenhum). */
  actor(id: string | null): T {
    this.currentActor = id;
    return this.self();
  }

  /** Passo genérico (o mesmo `do` + `params` do JSON). */
  do(command: string, params: Record<string, unknown> = {}): T {
    const spec = COMMANDS[command];
    const p = clean(params);
    this.push({ ...(spec?.actor !== 'none' && this.currentActor ? { actor: this.currentActor } : {}), do: command, ...(Object.keys(p).length ? { params: p } : {}) });
    return this.self();
  }

  pose(name: string, o: { transition?: PoseTransition; skin?: 'image' | 'parts' } = {}): T {
    return this.do('pose', { name, ...o });
  }
  move(id: string, o: { target?: string } = {}): T {
    return this.do('move', { id, ...o });
  }
  /** Ponto `[x, y]` ou rota (`"M … C …"`). */
  moveTo(to: Xy | string, duration: number, o: { ease?: EaseName; scaleTo?: number; relative?: boolean } = {}): T {
    return this.do('moveTo', { ...(typeof to === 'string' ? { route: to } : { to }), duration, ...o });
  }
  dash(velocity: Xy, o: { drag?: number; duration?: number } = {}): T {
    return this.do('dash', { velocity, ...o });
  }
  hover(): T {
    return this.do('hover');
  }
  fall(o: { vx?: number; vy?: number; gravity?: number } = {}): T {
    return this.do('fall', o);
  }
  /** Id (ator ou prop) ou lado (1 / -1). */
  face(target: string | 1 | -1): T {
    return this.do('face', typeof target === 'string' ? { target } : { dir: target });
  }
  play(clip: string, o: { fade?: number; speed?: number } = {}): T {
    return this.do('play', { clip, ...o });
  }
  camera(params: Record<string, unknown>): T {
    return this.do('camera', params);
  }
  fx(type: string, params: Record<string, unknown> = {}): T {
    return this.do('fx', { type, ...params });
  }
  spawnProp(type: string, at: Xy, size: Xy, o: { id?: string; state?: string; appear?: number } = {}): T {
    return this.do('spawnProp', { type, at, size, ...o });
  }
  prop(id: string, action: string, o: { duration?: number } = {}): T {
    return this.do('prop', { id, action, ...o });
  }
  enter(prop: string, duration: number, o: { ease?: EaseName } = {}): T {
    return this.do('enter', { prop, duration, ...o });
  }
  touch(prop: string, gap?: number): T {
    return this.do('touch', { prop, gap });
  }
  opacity(value: number): T {
    return this.do('opacity', { value });
  }
  /** Variante de expressão da pose (`"none"` volta à imagem da pose). */
  expression(name: string): T {
    return this.do('expression', { name });
  }
  /** Variante de mão da pose (`"none"` volta à imagem da pose). */
  hand(name: string): T {
    return this.do('hand', { name });
  }
  say(text: string, seconds?: number): T {
    return this.do('say', { text, seconds });
  }
  wait(seconds: number): T {
    return this.do('wait', { seconds });
  }
}

/** Filhos de um `parallel`: começam juntos; `delay(s)` atrasa os próximos. */
export class ParallelBuilder extends StepWriter<ParallelBuilder> {
  readonly steps: StepJson[] = [];
  private nextDelay = 0;
  protected self(): ParallelBuilder {
    return this;
  }
  protected push(step: StepJson): void {
    this.steps.push({ ...(this.nextDelay ? { delay: this.nextDelay } : {}), ...step });
  }
  delay(seconds: number): ParallelBuilder {
    this.nextDelay = seconds;
    return this;
  }
}

/**
 * API fluente equivalente ao JSON (gera o mesmo formato e passa pelo mesmo `parseScript`):
 *
 *   script({ title: '…' })
 *     .cast('<a>', { at: [0, 600], scale: 0.32, clip: 'idle_fly' })
 *     .at(0).actor('<a>').moveTo('M 0 600 C …', 1.6).as('fuga')
 *     .then().actor('<b>').pose('<pose>').move('<golpe>', { target: '<a>' })
 *     .on('hit:<prop>-><b>').actor('<b>').pose('<pose>', { transition: 'cut' })
 *
 * Gatilhos: `at(s)`, `after(id, delay)`, `on(evento, { nth, delay })` e `then(delay)` (depois do
 * último passo). O gatilho vale para todos os comandos seguintes, até o próximo gatilho: comandos
 * em sequência sem gatilho novo começam juntos.
 */
export class ScriptBuilder extends StepWriter<ScriptBuilder> {
  private readonly doc: ScriptJson;
  private trigger: Pick<StepJson, 'at' | 'after' | 'on' | 'nth' | 'delay'> = { at: 0 };
  private last: StepJson | null = null;
  private autoId = 0;

  constructor(head: Omit<ScriptJson, 'steps'> = {}) {
    super();
    this.doc = { ...head, steps: [] };
  }
  protected self(): ScriptBuilder {
    return this;
  }
  protected push(step: StepJson): void {
    const s = { ...this.trigger, ...step };
    this.doc.steps.push(s);
    this.last = s;
  }

  cast(id: string, spec: CastJson = {}): ScriptBuilder {
    (this.doc.cast ??= {})[id] = spec;
    return this;
  }
  at(seconds: number): ScriptBuilder {
    this.trigger = { at: seconds };
    return this;
  }
  after(id: string, delay = 0): ScriptBuilder {
    this.trigger = { after: id, ...(delay ? { delay } : {}) };
    return this;
  }
  on(event: string, o: { nth?: number; delay?: number } = {}): ScriptBuilder {
    this.trigger = { on: event, ...(o.nth && o.nth !== 1 ? { nth: o.nth } : {}), ...(o.delay ? { delay: o.delay } : {}) };
    return this;
  }
  /** Os próximos comandos começam quando o último passo terminar (+ delay). */
  then(delay = 0): ScriptBuilder {
    if (!this.last) throw new Error('then(): nenhum passo antes');
    this.last.id ??= `_${++this.autoId}`;
    return this.after(this.last.id, delay);
  }
  /** Dá um id ao último passo (para `after`/`then` e eventos start/done). */
  as(id: string): ScriptBuilder {
    if (!this.last) throw new Error('as(): nenhum passo antes');
    this.last.id = id;
    return this;
  }
  /** Passos juntos; o `parallel` termina quando todos terminam. */
  parallel(fn: (p: ParallelBuilder) => void): ScriptBuilder {
    const p = new ParallelBuilder();
    if (this.currentActor) p.actor(this.currentActor);
    fn(p);
    return this.do('parallel', { steps: p.steps });
  }

  /** O roteiro em JSON (o mesmo que se escreveria à mão). */
  toJSON(): ScriptJson {
    return structuredClone(this.doc);
  }
  /** Validado (mesmo leitor do JSON). */
  build(source = 'roteiro (API)'): Script {
    return parseScript(this.toJSON(), source);
  }
}

export function script(head: Omit<ScriptJson, 'steps'> = {}): ScriptBuilder {
  return new ScriptBuilder(head);
}

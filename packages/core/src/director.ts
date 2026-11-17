import { Actor, TRANSITION_FRAMES } from './actor.js';
import { defaultTransition, type Character, type PoseTransition } from './character.js';
import type { ClipData } from './clip.js';
import type { EaseName } from './easing.js';
import { AUTHOR_FPS, SIM_DT } from './loop.js';
import type { Vec2 } from './math.js';
import { Fall, Hover, MoveTo, dash } from './motion.js';
import type { MoveData } from './move.js';
import { hiddenQuad, hoverNear, fitScale, passPlan, planePoint, sideDistance, spanMiss, type PassPlan } from './passage.js';
import { getPropType, propAnchor, propOpening } from './props.js';
import { isAnchorTarget, parseScript, type Script, type ScriptStep } from './script.js';
import { World, type Fighter, type HitEvent, type Prop } from './world.js';

/** Evento `step`: um passo do roteiro começou ou terminou. */
export interface StepEvent {
  id: string | null;
  do: string;
  actor: string | null;
  params: Record<string, unknown>;
  phase: 'start' | 'end';
  time: number;
}

/**
 * Conferência de passagem, registrada na simulação: onde estava o centro visual do ator ao cruzar
 * o plano de uma abertura (`enter`, `exit`) ou ao encostar num prop que tem abertura (`contact`).
 * `miss` = px fora do vão no eixo transversal (0 = dentro; negativo = antes do começo do vão, ex.:
 * acima da porta; positivo = depois do fim, ex.: abaixo).
 */
export interface PassCheck {
  kind: 'enter' | 'exit' | 'contact';
  actor: string;
  prop: string;
  time: number;
  center: Vec2;
  axis: 'x' | 'y';
  span: [number, number];
  miss: number;
}

/** Um personagem do elenco: o Character (carregado) e os golpes dele. */
export interface CastMember {
  character: Character;
  moves?: Map<string, MoveData>;
}

export interface DirectorOptions {
  /** Personagens por id (os ids do elenco do roteiro). */
  characters: Record<string, CastMember> | Map<string, CastMember>;
  clips?: Map<string, ClipData>;
  /** Distância do aviso `incoming` (ver World). */
  incomingDistance?: number;
  /** Tamanho da vista (px CSS), para a câmera. */
  viewport?: { width: number; height: number };
  /** Avisos do roteiro (padrão: console.warn). */
  onWarning?: (message: string) => void;
}

/** Tipos de efeito que o World executa (além dos presets). */
export const FX_TYPES = ['impact', 'spark', 'muzzle', 'flash', 'afterimage', 'smear', 'shake', 'speedlines', 'slowmo', 'hitstop'] as const;

/** Balão de fala ativo. */
export interface Bubble {
  actor: string;
  text: string;
  until: number;
}

/** Quando o passo termina: em s (a partir de agora) ou quando a função devolver true. */
type Done = number | (() => boolean);

interface Run {
  step: ScriptStep;
  start: number;
  done: boolean;
  check: () => boolean;
  parent: Run | null;
  /** parallel: filhos que faltam terminar. */
  pending: number;
}

interface Activation {
  step: ScriptStep;
  time: number;
  order: number;
  payload: unknown;
  parent: Run | null;
}

interface Ctx {
  d: Director;
  step: ScriptStep;
  world: World;
  f: Fighter | null;
  p: Record<string, unknown>;
  payload: unknown;
  now: number;
}

type Listener = (payload: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

const EPS = 1e-6;
const v2 = (v: unknown) => v as Vec2;

/** Executores dos comandos (os parâmetros já foram validados por `parseScript`). */
const RUN: Record<string, (c: Ctx) => Done> = {
  pose({ f, p }) {
    const a = f!.actor;
    const transition = p['transition'] as PoseTransition | undefined;
    if (p['skin'] === 'parts') a.setSkin('parts', transition ? { transition } : {});
    else a.setPose(p['name'] as string, transition ? { transition } : {});
    return TRANSITION_FRAMES[transition ?? defaultTransition(p['name'] as string, a.character.basePose)] / AUTHOR_FPS;
  },
  move({ world, f, p }) {
    world.perform(f!.id, p['id'] as string, p['target'] as string | undefined);
    const r = f!.runner;
    return () => f!.runner !== r;
  },
  moveTo({ world, f, p }) {
    const a = f!.actor;
    const raw = p['to'];
    const center = p['align'] === 'center';
    // Centro visual: o destino vale para o centro da silhueta, não para o quadril.
    const shift = (q: Vec2): Vec2 => {
      if (!center) return q;
      const o = a.visualOffset();
      return { x: q.x - o.x, y: q.y - o.y };
    };
    let to: Vec2 | (() => Vec2) | undefined;
    if (isAnchorTarget(raw)) {
      const t = raw;
      // Resolvida a cada passo: acompanha o prop (posição e tamanho atuais).
      to = () => {
        const q = propAnchor(needProp(world, t.prop), t.anchor);
        return shift({ x: q.x + t.offset.x, y: q.y + t.offset.y });
      };
      to();
    } else if (raw) {
      let q = { ...v2(raw) };
      if (p['relative']) q = { x: a.position.x + q.x, y: a.position.y + q.y };
      const fixed = q;
      to = center ? () => shift(fixed) : fixed;
    }
    const m = new MoveTo({ ...(to ? { to } : { route: p['route'] as string }), duration: p['duration'] as number, ease: p['ease'] as EaseName | undefined, scaleTo: p['scaleTo'] as number | undefined });
    world.setMotion(f!.id, m);
    return () => f!.motion !== m;
  },
  dash({ world, f, p }) {
    const a = f!.actor;
    const v = v2(p['velocity']);
    const m = dash({ x: v.x * a.facing, y: v.y }, { drag: p['drag'] as number | undefined, duration: p['duration'] as number | undefined });
    world.setMotion(f!.id, m);
    a.afterimage({ frames: 12, every: 2, life: 12, alpha: 0.5 });
    return () => f!.motion !== m;
  },
  hover({ world, f }) {
    world.setMotion(f!.id, new Hover());
    return 0;
  },
  fall({ world, f, p }) {
    world.setMotion(f!.id, new Fall((p['vx'] as number) ?? 0, (p['vy'] as number) ?? 0, (p['gravity'] as number) ?? 2600));
    return 0;
  },
  face({ world, f, p }) {
    const a = f!.actor;
    if (p['dir'] !== undefined) a.facing = (p['dir'] as number) < 0 ? -1 : 1;
    else {
      const id = p['target'] as string;
      const prop = world.props.get(id);
      a.face(prop ? { x: prop.box.x + prop.box.w / 2, y: prop.box.y + prop.box.h / 2 } : world.fighter(id).actor);
    }
    return 0;
  },
  play({ d, f, p }) {
    const clip = d.world.clip(p['clip'] as string);
    f!.actor.play(clip, { fade: (p['fade'] as number) ?? 6, restart: true, ...(p['speed'] !== undefined ? { speed: p['speed'] as number } : {}) });
    return 0;
  },
  camera({ world, p }) {
    return applyCamera(world, p);
  },
  fx({ world, f, p, payload }) {
    const { at, dir, ...spec } = p;
    const ev = payload as { point?: Vec2; at?: Vec2 } | null;
    world.runFx(spec as { type: string }, { fighter: f, at: at ? v2(at) : (ev?.point ?? ev?.at ?? null), dir: dir ? v2(dir) : null });
    return 0;
  },
  spawnProp({ world, p, now }) {
    const type = p['type'] as string;
    const def = getPropType(type);
    if (!def) throw new Error(`roteiro: tipo de prop "${type}" não registrado (registerProp)`);
    const at = v2(p['at']), size = v2(p['size']);
    const state = (p['state'] as string | undefined) ?? def.states[0]!;
    const appear = (p['appear'] as number | undefined) ?? 0.25;
    const prop: Prop = { id: (p['id'] as string | undefined) ?? type, type, box: { x: at.x, y: at.y, w: size.x, h: size.y }, solid: def.solid.includes(state), state, bornAt: now, appear };
    if (p['facing'] !== undefined) prop.facing = (p['facing'] as number) < 0 ? -1 : 1;
    world.addProp(prop);
    return appear;
  },
  prop({ d, world, p, now }) {
    const id = p['id'] as string;
    const prop = world.props.get(id);
    if (!prop) throw new Error(`roteiro: o prop "${id}" ainda não existe (spawnProp vem antes)`);
    if (p['action'] === 'remove') {
      world.removeProp(id);
      return 0;
    }
    const def = getPropType(prop.type)!;
    const state = def.actions[p['action'] as string];
    if (state === undefined) throw new Error(`roteiro: o prop "${id}" não tem a ação "${p['action']}"`);
    const dur = (p['duration'] as number | undefined) ?? 0.12;
    prop.previous = prop.state;
    prop.state = state;
    prop.changedAt = now;
    prop.changeTime = dur;
    if (!def.solid.includes(state)) {
      prop.solid = false;
      return dur;
    }
    // Fica sólido quando a animação termina (a porta fechada de verdade).
    return () => {
      if (d.time < now + dur - EPS) return false;
      prop.solid = true;
      return true;
    };
  },
  enter({ d, world, f, p, now }) {
    const a = f!.actor;
    const prop = needProp(world, p['prop'] as string);
    const plan0 = passPlan(needOpening(prop, 'enter'), a.visualCenter(), prop.facing ?? -1);
    const b = a.bounds();
    const ext = plan0.axis === 'x' ? b.w : b.h;
    // Encolhe até caber no vão (no máximo 70 % da escala de agora, se não pedir outra).
    const shrink = (p['shrink'] as number | undefined) ?? Math.min(0.7, fitScale(plan0, plan0.axis === 'x' ? b.h : b.w));
    const depth = (ext * shrink) / 2 + 10;
    d.entered.set(f!.id, { scale: a.scale, collideProps: f!.collideProps });
    f!.collideProps = false;
    if (plan0.axis === 'x') a.facing = plan0.side < 0 ? 1 : -1;
    // Plano atual (o prop pode ter mudado), mantendo o lado de onde o ator veio.
    const plan = (): PassPlan => ({ ...passPlan(needOpening(prop, 'enter'), a.visualCenter()), side: plan0.side });
    // Destino: o centro visual inteiro do outro lado do plano, no meio do vão.
    const target = () => {
      const q = planePoint(plan(), -depth);
      const o = a.visualOffset();
      return { x: q.x - o.x, y: q.y - o.y };
    };
    d.hidden.set(f!.id, hiddenQuad(plan0));
    const m = new MoveTo({ to: target, duration: p['duration'] as number, ease: (p['ease'] as EaseName | undefined) ?? 'cubicIn', scaleTo: a.scale * shrink });
    world.setMotion(f!.id, m);
    return passWatch(d, f!, prop.id, 'enter', plan, Math.max(ext, 60), now, () => f!.motion !== m, () => {
      a.opacity = 0;
      a.hoverWeight = 1;
      d.hidden.delete(f!.id);
      world.setMotion(f!.id, new Hover());
    });
  },
  exit({ d, world, f, p, now }) {
    const a = f!.actor;
    const prop = needProp(world, p['prop'] as string);
    const anchor = (p['to'] as string | undefined) ?? 'front';
    const off = p['offset'] ? v2(p['offset']) : { x: 0, y: 0 };
    const dest = () => {
      const q = propAnchor(prop, anchor);
      return { x: q.x + off.x, y: q.y + off.y };
    };
    const plan0 = passPlan(needOpening(prop, 'exit'), dest(), prop.facing ?? -1);
    const before = d.entered.get(f!.id);
    d.entered.delete(f!.id);
    const end = (p['scaleTo'] as number | undefined) ?? before?.scale ?? a.scale;
    // Nasce pequeno do lado de trás do plano, sem flutuar, e cresce saindo.
    a.scale = end;
    a.hoverWeight = 0;
    a.opacity = 1;
    if (plan0.axis === 'x') a.facing = plan0.side > 0 ? 1 : -1;
    a.settle();
    const b = a.bounds();
    const ext = plan0.axis === 'x' ? b.w : b.h;
    const shrink = (p['shrink'] as number | undefined) ?? Math.min(0.7, fitScale(plan0, plan0.axis === 'x' ? b.h : b.w));
    a.scale = end * shrink;
    a.settle();
    const start = planePoint(plan0, -((ext * shrink) / 2 + 10));
    const o = a.visualOffset();
    a.position = { x: start.x - o.x, y: start.y - o.y };
    a.velocity = { x: 0, y: 0 };
    a.settle();
    const collide = before?.collideProps ?? f!.collideProps;
    f!.collideProps = false;
    const plan = (): PassPlan => ({ ...passPlan(needOpening(prop, 'exit'), a.visualCenter()), side: plan0.side });
    d.hidden.set(f!.id, hiddenQuad(plan0));
    const target = () => {
      const q = dest();
      const v = a.visualOffset();
      return { x: q.x - v.x, y: q.y - v.y };
    };
    const m = new MoveTo({ to: target, duration: p['duration'] as number, ease: (p['ease'] as EaseName | undefined) ?? 'cubicOut', scaleTo: end });
    world.setMotion(f!.id, m);
    return passWatch(d, f!, prop.id, 'exit', plan, Math.max(ext, 60), now, () => f!.motion !== m, () => {
      a.hoverWeight = 1;
      d.hidden.delete(f!.id);
      f!.collideProps = collide;
      world.setMotion(f!.id, new Hover());
    });
  },
  touch({ world, f, p }) {
    const a = f!.actor;
    const prop = needProp(world, p['prop'] as string);
    const b = a.bounds();
    const gap = (p['gap'] as number | undefined) ?? 0;
    const face = a.facing > 0 ? prop.box.x - gap : prop.box.x + prop.box.w + gap;
    a.position.x += face - (a.facing > 0 ? b.x + b.w : b.x);
    world.setMotion(f!.id, null);
    return 0;
  },
  opacity({ f, p }) {
    f!.actor.opacity = p['value'] as number;
    return 0;
  },
  say({ d, f, p, now }) {
    const seconds = (p['seconds'] as number | undefined) ?? 1.5;
    d.bubbles.push({ actor: f!.id, text: p['text'] as string, until: now + seconds });
    return seconds;
  },
  wait({ p }) {
    return p['seconds'] as number;
  },
  expression: (c) => chooseVariant(c, 'expression'),
  hand: (c) => chooseVariant(c, 'hand'),
};

function needProp(world: World, id: string): Prop {
  const prop = world.props.get(id);
  if (!prop) throw new Error(`roteiro: o prop "${id}" ainda não existe (spawnProp vem antes)`);
  return prop;
}

function needOpening(prop: Prop, cmd: string) {
  const o = propOpening(prop);
  if (!o) throw new Error(`roteiro: "${cmd}" precisa de um prop com abertura, e "${prop.id}" (${prop.type}) não tem`);
  return o;
}

/**
 * Acompanha a passagem a cada passo: tira a flutuação perto do plano (`reach` px), move o recorte
 * com o prop e registra a conferência quando o centro visual cruza o plano (ou no fim, se não cruzou).
 */
function passWatch(d: Director, f: Fighter, prop: string, kind: 'enter' | 'exit', plan: () => PassPlan, reach: number, start: number, moved: () => boolean, finish: () => void): () => boolean {
  const a = f.actor;
  let checked = false;
  const check = (pl: PassPlan) => {
    checked = true;
    const c = a.visualCenter();
    d.passChecks.push({ kind, actor: f.id, prop, time: d.time, center: c, axis: pl.axis, span: pl.span, miss: spanMiss(pl, c) });
  };
  return () => {
    const pl = plan();
    const dist = sideDistance(pl, a.visualCenter());
    a.hoverWeight = hoverNear(dist, reach);
    d.hidden.set(f.id, hiddenQuad(pl));
    const crossed = kind === 'enter' ? dist <= 0 : dist >= 0;
    if (!checked && crossed && d.time > start) check(pl);
    if (!moved()) return false;
    if (!checked) check(pl);
    finish();
    return true;
  };
}

/** expression / hand: escolhe a variante; sem ela na pose atual, a pose fica como está (aviso). */
function chooseVariant({ d, f, p }: Ctx, kind: string): Done {
  const name = p['name'] as string;
  const a = f!.actor;
  // Variante que não existe em pose nenhuma já foi avisada na carga.
  if (!a.setVariant(kind, name === 'none' ? null : name) && a.character.posesWithVariant(name, kind).length) d.warn(`"${f!.id}" na pose "${a.poseName}" não tem a variante "${name}" (${kind}): mantém a imagem da pose`);
  return 0;
}

/** Comando de câmera (passo `camera` e o `camera` do roteiro). Devolve a duração (s). */
function applyCamera(world: World, p: Record<string, unknown>): number {
  const cam = world.camera;
  const n = (k: string) => p[k] as number | undefined;
  const seconds = n('seconds');
  const autoKeys = ['targets', 'margin', 'minZoom', 'maxZoom'].filter((k) => p[k] !== undefined);
  if (p['mode'] === 'auto' || (!p['mode'] && autoKeys.length && !p['follow'] && !p['pan']))
    cam.setAuto({ ...(p['targets'] ? { targets: p['targets'] as string[] } : {}), margin: n('margin'), minZoom: n('minZoom'), maxZoom: n('maxZoom') });
  if (p['follow']) cam.follow(p['follow'] as string);
  if (p['pan']) cam.pan(v2(p['pan']).x, v2(p['pan']).y, seconds ?? 0.6);
  if ('zoom' in p) cam.zoomTo(p['zoom'] as number | null, seconds ?? 0.4);
  if (n('shake')) cam.shake(n('shake')!);
  if (p['snap']) cam.snap();
  return p['pan'] || 'zoom' in p ? (seconds ?? 0) : 0;
}

/**
 * Diretor de cena: executa um roteiro sobre o World em passo fixo (120 Hz). Determinístico:
 * `seek(t)` recria a cena e re-simula do início (as trocas de pose entram na re-simulação).
 * Roda sem navegador (não desenha; a `Scene` desenha).
 *
 * Eventos (`on`): todos os do World ("hit", "hit:<a>-><b>", "incoming:<a>-><b>", "spawn:<id>",
 * "moveEnd:<id>", "phase", "fx", …), mais "step" ({ id, do, actor, params, phase: "start" | "end" }) e "end".
 * Durante o `seek` os eventos ficam calados.
 */
export class Director {
  world!: World;
  /** Tempo da cena (s). */
  time = 0;
  /** Duração (s): a do roteiro ou medida (fim do último passo + `tail`). */
  duration = 0;
  loop = false;
  timeScale = 1;
  playing = false;
  /** Atores sendo recortados por um prop ("enter", "exit"): id → região escondida (mundo). */
  readonly hidden = new Map<string, Vec2[]>();
  /** Quem entrou num prop e ainda não saiu: a escala e o `collideProps` de antes (o `exit` restaura). */
  readonly entered = new Map<string, { scale: number; collideProps: boolean }>();
  /** Conferências de passagem da simulação até agora (o `validate` acusa as que erram o vão). */
  readonly passChecks: PassCheck[] = [];
  readonly bubbles: Bubble[] = [];
  /** Avisos (sem repetir): variante que não existe, por exemplo. Também saem no evento "warning". */
  readonly warnings: string[] = [];
  readonly clips: Map<string, ClipData>;
  private readonly cast: Map<string, CastMember>;
  private actors: Actor[] = [];
  private queue: Activation[] = [];
  private running: Run[] = [];
  private onCount = new Map<ScriptStep, number>();
  private readonly onSteps = new Map<string, ScriptStep[]>();
  private readonly afterSteps = new Map<string, ScriptStep[]>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private order = 0;
  private silent = false;
  private ended = false;
  /** Tempo em que os eventos de dentro do passo do World acontecem. */
  private eventTime = 0;
  private acc = 0;
  /** Último instante com passo em andamento ou na fila. */
  private busyUntil = 0;

  private constructor(
    readonly script: Script,
    private readonly options: DirectorOptions,
  ) {
    this.cast = options.characters instanceof Map ? options.characters : new Map(Object.entries(options.characters));
    this.clips = options.clips ?? new Map();
    for (const s of script.steps) {
      if (s.on !== null) this.onSteps.set(s.on, [...(this.onSteps.get(s.on) ?? []), s]);
      if (s.after !== null) this.afterSteps.set(s.after, [...(this.afterSteps.get(s.after) ?? []), s]);
    }
  }

  /**
   * Lê o roteiro (JSON ou já lido), carrega as poses citadas e mede a duração. A conferência
   * detalhada dos nomes (poses, golpes, clipes, efeitos, props, com as listas do que existe) é
   * `checkScene`, de `sprite-fighter/authoring`.
   */
  static async create(script: unknown, options: DirectorOptions, source = 'roteiro'): Promise<Director> {
    const s = isScript(script) ? script : parseScript(script, source);
    const cast = options.characters instanceof Map ? options.characters : new Map(Object.entries(options.characters));
    for (const id of s.cast.keys()) if (!cast.has(id)) throw new Error(`${source}: o elenco cita "${id}", que não foi carregado (personagens: ${[...cast.keys()].join(', ')})`);
    const member = (id: string) => cast.get(id)!;
    // Poses citadas (elenco e passos `pose`) carregadas antes: a cena não espera no meio.
    for (const [id, c] of s.cast) if (c.pose) await member(id).character.loadPose(c.pose);
    const each = (steps: ScriptStep[]): Promise<unknown>[] =>
      steps.flatMap((st) => [...(st.do === 'pose' && st.actor && st.params['skin'] !== 'parts' ? [member(st.actor).character.loadPose(st.params['name'] as string)] : []), ...each(st.steps)]);
    await Promise.all(each(s.steps));
    // Variantes citadas (expression/hand): carregadas em toda pose do ator que as tem.
    const early: string[] = [];
    const variants = (steps: ScriptStep[]): Promise<unknown>[] =>
      steps.flatMap((st) => {
        const own: Promise<unknown>[] = [];
        if ((st.do === 'expression' || st.do === 'hand') && st.actor && st.params['name'] !== 'none') {
          const ch = member(st.actor).character;
          const poses = ch.posesWithVariant(st.params['name'] as string, st.do);
          if (!poses.length) early.push(`"${st.actor}" não tem a variante "${st.params['name']}" (${st.do}) em nenhuma pose: o passo não muda a imagem`);
          own.push(...poses.map((pose) => ch.loadVariant(pose, st.params['name'] as string)));
        }
        return [...own, ...variants(st.steps)];
      });
    await Promise.all(variants(s.steps));
    const d = new Director(s, options);
    for (const w of early) d.warn(w);
    d.reset();
    await d.world.prepare(); // poses dos golpes (e as de reação dos alvos)
    d.duration = s.duration ?? d.measure();
    d.reset();
    return d;
  }

  on(event: string, fn: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  private emit(event: string, payload: unknown): void {
    if (this.silent) return;
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }

  /** Registra um aviso (uma vez só): `options.onWarning` (padrão console.warn) e evento "warning". */
  warn(message: string): void {
    if (this.warnings.includes(message)) return;
    this.warnings.push(message);
    (this.options.onWarning ?? ((m: string) => console.warn(m)))(`roteiro: ${message}`);
    for (const fn of this.listeners.get('warning') ?? []) fn({ message });
  }

  get progress(): number {
    return this.duration > 0 ? Math.min(1, this.time / this.duration) : 0;
  }
  get fighters(): Fighter[] {
    return [...this.script.cast.keys()].map((id) => this.world.fighter(id));
  }
  get viewport(): { width: number; height: number } | undefined {
    return this.options.viewport;
  }
  set viewport(v: { width: number; height: number } | undefined) {
    this.options.viewport = v;
    if (v && this.world) {
      this.world.camera.width = v.width;
      this.world.camera.height = v.height;
      // Ainda no instante 0: reenquadra com o tamanho novo (igual a um reset com ele).
      if (this.time === 0) this.world.frameCamera();
    }
  }

  /** Fim de uso: pausa, solta os actors (deixam de seguir os Characters) e os ouvintes. */
  dispose(): void {
    this.pause();
    for (const a of this.actors) a.dispose();
    this.actors = [];
    this.listeners.clear();
  }

  /** Recria a cena no instante 0 (atores, World, câmera, fila de passos). */
  reset(): void {
    for (const a of this.actors) a.dispose();
    const s = this.script;
    const world = new World({ clips: this.clips, seed: s.seed, ...(this.options.incomingDistance !== undefined ? { incomingDistance: this.options.incomingDistance } : {}) });
    this.actors = [];
    for (const [id, c] of s.cast) {
      const m = this.cast.get(id)!;
      const ch = m.character;
      const pose = c.pose ?? ch.basePose ?? ch.pose;
      if (!ch.imagePoses.has(pose)) throw new Error(`pose-imagem "${pose}" de ${ch.name} não carregada (use loadPose)`);
      const a = new Actor(ch, { scale: c.scale, pose });
      a.position = { ...c.at };
      a.facing = c.facing;
      a.opacity = c.opacity;
      if (c.clip) a.play(world.clip(c.clip));
      this.actors.push(a);
      world.add(id, a, m.moves ?? new Map()).collideProps = c.collideProps;
    }
    if (this.options.viewport) {
      world.camera.width = this.options.viewport.width;
      world.camera.height = this.options.viewport.height;
    }
    if (s.camera) applyCamera(world, s.camera);
    for (const a of this.actors) a.settle();
    // A câmera nasce enquadrada: o quadro em t = 0 (início, seek, recomeço) já é o enquadramento-alvo.
    world.frameCamera();
    world.onAny((name, payload) => this.event(name, payload));
    this.world = world;
    this.time = this.eventTime = this.acc = this.busyUntil = 0;
    this.queue = [];
    this.running = [];
    this.onCount = new Map();
    this.hidden.clear();
    this.entered.clear();
    this.passChecks.length = 0;
    this.bubbles.length = 0;
    this.order = 0;
    this.ended = false;
    s.steps.forEach((st) => {
      if (st.at !== null) this.enqueue(st, st.at + st.delay, null, null);
    });
  }

  private enqueue(step: ScriptStep, time: number, payload: unknown, parent: Run | null): void {
    this.queue.push({ step, time, order: this.order++, payload, parent });
    this.queue.sort((a, b) => a.time - b.time || a.order - b.order);
  }

  /** Evento do World ou do diretor: repassa e dispara os passos `on`. */
  private event(name: string, payload: unknown): void {
    if (name === 'hit') this.contactCheck(payload as HitEvent);
    this.emit(name, payload);
    for (const st of this.onSteps.get(name) ?? []) {
      const n = (this.onCount.get(st) ?? 0) + 1;
      this.onCount.set(st, n);
      if (n === st.nth) this.enqueue(st, this.eventTime + st.delay, payload, null);
    }
  }

  /** Corpo encostou num prop com abertura: o centro visual estava dentro do vão? */
  private contactCheck(e: HitEvent): void {
    if (e.by !== 'prop') return;
    const prop = this.world.props.get(e.attacker);
    const op = prop && propOpening(prop);
    const f = this.world.fighters.get(e.target);
    if (!op || !f) return;
    const c = f.actor.visualCenter();
    const pl = passPlan(op, c);
    this.passChecks.push({ kind: 'contact', actor: f.id, prop: prop.id, time: this.eventTime, center: c, axis: pl.axis, span: pl.span, miss: spanMiss(pl, c) });
  }

  /** Executa os passos da fila que já venceram (inclusive os que eles encadeiam agora). */
  private fireDue(): void {
    while (this.queue.length && this.queue[0]!.time <= this.time + EPS) this.exec(this.queue.shift()!);
  }

  private exec(act: Activation): void {
    const { step, parent, payload } = act;
    const now = this.time;
    if (step.id) this.event(`start:${step.id}`, { id: step.id });
    this.emit('step', { id: step.id, do: step.do, actor: step.actor, params: step.params, phase: 'start', time: now } satisfies StepEvent);
    const run: Run = { step, start: now, done: false, check: () => run.pending === 0, parent, pending: 0 };
    if (step.do === 'parallel') {
      run.pending = step.steps.length;
      for (const c of step.steps) this.enqueue(c, now + c.delay, payload, run);
    } else {
      const f = step.actor ? this.world.fighter(step.actor) : null;
      const done = RUN[step.do]!({ d: this, step, world: this.world, f, p: step.params, payload, now });
      run.check = typeof done === 'number' ? () => this.time >= now + done - EPS : done;
    }
    this.running.push(run);
    this.settle(run);
  }

  /** Confere se o passo terminou; se sim, encadeia os `after` e avisa o pai (parallel). */
  private settle(run: Run): void {
    if (run.done || !run.check()) return;
    run.done = true;
    this.busyUntil = this.time;
    const { step } = run;
    this.emit('step', { id: step.id, do: step.do, actor: step.actor, params: step.params, phase: 'end', time: this.time } satisfies StepEvent);
    if (step.id) {
      this.event(`done:${step.id}`, { id: step.id });
      for (const next of this.afterSteps.get(step.id) ?? []) this.enqueue(next, this.time + next.delay, null, null);
    }
    if (run.parent) {
      run.parent.pending--;
      this.settle(run.parent);
    }
  }

  /** Um passo fixo (SIM_DT). */
  step(): void {
    this.fireDue();
    this.eventTime = this.time + SIM_DT;
    this.world.step(SIM_DT);
    this.time += SIM_DT;
    this.eventTime = this.time;
    for (const r of this.running) this.settle(r);
    this.running = this.running.filter((r) => !r.done);
    if (this.running.length || this.queue.length) this.busyUntil = this.time;
    for (let i = this.bubbles.length - 1; i >= 0; i--) if (this.bubbles[i]!.until <= this.time) this.bubbles.splice(i, 1);
    if (!this.ended && this.duration > 0 && this.time >= this.duration - EPS) {
      this.ended = true;
      this.emit('end', { time: this.time });
      if (this.loop) this.seek(0);
    }
  }

  /** Vai para o instante `t` (s): recria a cena e re-simula do início, em silêncio. */
  seek(t: number): void {
    this.reset();
    const target = Math.max(0, Math.min(t, this.duration || t));
    this.silent = true;
    try {
      while (this.time < target - EPS) this.step();
    } finally {
      this.silent = false;
    }
  }

  play(): void {
    if (this.ended && !this.loop) this.seek(0);
    this.playing = true;
  }
  pause(): void {
    this.playing = false;
  }

  /**
   * Avança `dt` s de tempo real (× `timeScale`) em passos fixos, se estiver tocando. Devolve a
   * fração (0..1) entre o último passo e o próximo, para a interpolação do desenho.
   */
  advance(dt: number): number {
    if (!this.playing) return 1;
    this.acc += Math.min(dt, 0.25) * this.timeScale;
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      this.step();
      if (this.ended && !this.loop) {
        this.playing = false;
        this.acc = 0;
        return 1;
      }
    }
    return this.acc / SIM_DT;
  }

  /**
   * Mede a duração: roda em silêncio até não haver passo em andamento nem na fila por `tail` s
   * (passos `on` ainda esperando ganham até 2 s), no máximo 120 s.
   */
  private measure(): number {
    this.reset();
    this.silent = true;
    try {
      const wait = Math.max(this.script.tail, 2);
      while (this.time < 120 && this.time - this.busyUntil < wait) this.step();
    } finally {
      this.silent = false;
    }
    return this.busyUntil + this.script.tail;
  }

  /** Passos `on` que ainda não dispararam (validação: evento que nunca acontece). */
  unfired(): ScriptStep[] {
    return [...this.onSteps.values()].flat().filter((s) => (this.onCount.get(s) ?? 0) < s.nth);
  }
}

function isScript(x: unknown): x is Script {
  return typeof x === 'object' && x !== null && (x as Script).cast instanceof Map;
}


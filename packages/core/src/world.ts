import { getAction, hasAction, type ActionContext, type FxApi } from './actions.js';
import { Actor } from './actor.js';
import type { ClipData } from './clip.js';
import { capsuleBoxHit, capsuleHit, circle, type Box, type Capsule } from './collision.js';
import { ease, type EaseName } from './easing.js';
import { hurtboxesOf } from './hurtbox.js';
import { AUTHOR_FPS } from './loop.js';
import type { Vec2 } from './math.js';
import { Hover, dash, knockback, type Motion } from './motion.js';
import { MoveRunner, checkMovePoses, type MoveData, type OnHitSpec, type PhaseSpec } from './move.js';
import { createRng } from './rng.js';
import { CameraRig, type Rect } from './camera.js';
import { Effects } from './fx.js';
import type { AfterimageOptions } from './actor.js';
import type { FxSpec } from './move.js';
import { DataError } from './validate.js';

/** Personagem em luta: o Actor mais movimento dirigido, golpe em andamento e estado de reação. */
export class Fighter {
  /** Movimento principal (moveTo, dash, knockback, queda…). null = parado. */
  motion: Motion | null = null;
  /** Deslocamento extra somado ao movimento principal (esquiva de uma fase). */
  overlay: { by: Vec2; ease: EaseName; frames: number; t: number; done: Vec2 } | null = null;
  runner: MoveRunner | null = null;
  target: Fighter | null = null;
  /** Frames de reação restantes (atordoado depois de um contato). */
  stun = 0;
  /** Cápsulas do corpo na pose atual (atualizadas a cada passo). */
  hurtboxes: (Capsule & { bone: number })[] = [];
  /** Hitboxes ativas neste passo. */
  hitboxes: Capsule[] = [];
  /** Colide com props sólidos (porta). */
  collideProps = true;
  /** Hitstop: frames congelado restantes e o tremor do corpo (alvo treme, atacante não). */
  hitstop = 0;
  hitShake = 0;

  constructor(
    readonly id: string,
    readonly actor: Actor,
    readonly moves: Map<string, MoveData>,
  ) {}

  /** Pose base (a padrão do personagem, o voo). */
  get base(): string {
    return this.actor.character.basePose ?? this.actor.poseName;
  }
  get busy(): boolean {
    return !!this.runner || this.stun > 0;
  }
  /** Centro do tronco no mundo (mira). */
  center(): Vec2 {
    const s = this.actor.sim;
    const i = s.rig.byName.get('torso');
    if (i === undefined) return { ...this.actor.position };
    const a = s.pivotWorld(i), b = s.endWorld(i);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}

export interface Projectile {
  id: number;
  kind: string;
  owner: string;
  move: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  /** Frames de vida restantes. */
  life: number;
  onHit: OnHitSpec | null;
  alive: boolean;
  /** Alvos já avisados com o evento `incoming` (um aviso por alvo). */
  warned: Set<string>;
}

/** Objeto de cena com colisor de caixa (porta, parede). */
export interface Prop {
  id: string;
  type: string;
  box: Box;
  /** Sólido: personagens e projéteis batem nele. */
  solid: boolean;
  /** Estado de desenho (ex.: porta "open"/"closed") e a animação da troca (s, tempo da cena). */
  state?: string;
  previous?: string;
  changedAt?: number;
  changeTime?: number;
  /** Quando surgiu e quanto dura o surgimento (s). */
  bornAt?: number;
  appear?: number;
}

export interface HitEvent {
  /** Quem bateu (id do fighter ou do prop). */
  attacker: string;
  target: string;
  by: 'hitbox' | 'projectile' | 'prop';
  move: string | null;
  phase: string | null;
  point: Vec2;
  onHit: OnHitSpec | null;
  /** Tempo do World (s) e número do contato (1, 2, …). */
  time: number;
  index: number;
}

type Listener = (e: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
type AnyListener = (event: string, payload: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

const AIM_BONES: [string, string] = ['arm_front_upper', 'arm_front_fore'];

/** Quem recebe um efeito: o personagem (troca de pose, dash) e/ou o ponto e a direção do contato. */
export interface FxTarget {
  fighter?: Fighter | null;
  target?: Fighter | null;
  at?: Vec2 | null;
  dir?: Vec2 | null;
}

/**
 * Efeitos nomeados (usados nos golpes por nome, ex. `"fx": ["impact_big"]`): cada um vira uma
 * lista de efeitos simples. Objetos com `type` passam direto (`{ "type": "impact", "size": 1.4 }`).
 */
export const FX_PRESETS: Record<string, FxSpec[]> = {
  impact_small: [{ type: 'impact', size: 0.6 }, { type: 'flash', frames: 2 }, { type: 'shake', amount: 0.28 }],
  impact_big: [{ type: 'impact', size: 1.25 }, { type: 'flash', frames: 3 }, { type: 'shake', amount: 0.5 }, { type: 'speedlines', focus: true, frames: 14 }],
};

/**
 * Simulação de luta, determinística e em passo fixo: personagens (movimento dirigido + golpes em
 * fases), projéteis, props e contato (hitbox × hurtbox, projétil × hurtbox, corpo × prop).
 * Game feel: hitstop (atacante e alvo congelam, inclusive a troca de pose; a câmera continua),
 * efeitos (`fx`), câmera (`camera`) e câmera lenta por trecho (`slowMotion`).
 * Eventos: "hit" (e "hit:<atacante>-><alvo>"), "phase", "moveEnd" (e "moveEnd:<id>"), "spawn"
 * (e "spawn:<dono>"), "incoming:<dono>-><alvo>" (projétil chegando perto), "fx", "camera".
 */
export class World {
  readonly fighters = new Map<string, Fighter>();
  readonly projectiles: Projectile[] = [];
  readonly props = new Map<string, Prop>();
  readonly hits: HitEvent[] = [];
  readonly rng: () => number;
  /** Tempo simulado (s; anda devagar na câmera lenta). */
  time = 0;
  /** Tempo real da cena (s). */
  realTime = 0;
  readonly fx: Effects;
  readonly camera: CameraRig;
  /** Câmera lenta em andamento (tempo real). */
  private slow: { scale: number; start: number; duration: number; ramp: number } | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly anyListeners = new Set<AnyListener>();
  private readonly propContacts = new Set<string>();
  private nextProjectile = 1;

  /**
   * `incomingDistance`: distância (px do mundo) do projétil ao centro do alvo em que sai o aviso
   * `incoming:<dono>-><alvo>` (o roteiro pode reagir, ex.: esquivar).
   */
  constructor(readonly options: { clips?: Map<string, ClipData>; seed?: number; incomingDistance?: number } = {}) {
    this.rng = createRng(options.seed ?? 1);
    this.fx = new Effects(options.seed ?? 1);
    this.camera = new CameraRig(options.seed ?? 1);
  }

  /** Clipe pelo id (erro claro se não foi carregado). */
  clip(id: string): ClipData {
    const c = this.clips.get(id);
    if (!c) throw new Error(`clipe "${id}" não carregado (passe-o em "clips")`);
    return c;
  }

  /**
   * Câmera lenta por `seconds` (tempo real): a simulação anda × `scale`, entrando e saindo em
   * `ramp` s. A câmera e a tremida seguem em tempo real.
   */
  slowMotion(scale: number, seconds: number, ramp = 0.08): void {
    this.slow = { scale, start: this.realTime, duration: seconds, ramp };
  }

  /** Fator de tempo atual (1 = normal). */
  get timeScale(): number {
    const s = this.slow;
    if (!s) return 1;
    const t = this.realTime - s.start;
    if (t >= s.duration) return 1;
    const k = s.ramp > 0 ? Math.min(1, t / s.ramp, (s.duration - t) / s.ramp) : 1;
    return 1 + (s.scale - 1) * Math.max(0, k);
  }

  /**
   * Executa um efeito: nome de preset ou `{ type, ... }`. Tipos: impact, spark, muzzle, flash,
   * afterimage, smear, shake, speedlines, slowmo, hitstop.
   */
  runFx(spec: FxSpec | string, on: FxTarget = {}): void {
    const sp: FxSpec = typeof spec === 'string' ? { type: spec } : spec;
    const preset = FX_PRESETS[sp.type];
    if (preset) {
      for (const p of preset) this.runFx({ ...p, ...(sp.type === p.type ? {} : stripType(sp)) }, on);
      return;
    }
    const num = (k: string, d: number) => (typeof sp[k] === 'number' ? (sp[k] as number) : d);
    const str = (k: string, d: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : d);
    const who = on.target ?? on.fighter ?? null;
    const at = on.at ?? (on.fighter ? on.fighter.center() : null);
    const dir = on.dir ?? (on.fighter ? { x: on.fighter.actor.facing, y: 0 } : null);
    const scale = (on.fighter ?? on.target)?.actor.scale ?? 1;
    switch (sp.type) {
      case 'impact':
        if (at) this.fx.impact(at, { size: num('size', 1) * scale * 2, dir, color: typeof sp['color'] === 'string' ? (sp['color'] as string) : undefined });
        break;
      case 'spark':
        if (at) this.fx.spark(at, { count: num('count', 10), dir, size: num('size', 1) * scale * 2 });
        break;
      case 'muzzle': {
        const f = on.fighter;
        const bone = f?.actor.sim.rig.byName.get(str('bone', 'hand_front'));
        const p = f && bone !== undefined ? f.actor.sim.endWorld(bone) : at;
        if (p) this.fx.muzzle(p, dir, num('size', 0.45) * scale * 2);
        break;
      }
      case 'flash':
        who?.actor.flash(num('frames', 3), str('color', '#ffffff'));
        break;
      case 'afterimage': {
        const o: AfterimageOptions = { frames: num('frames', 12), every: num('every', 2), life: num('life', 12), alpha: num('alpha', 0.5) };
        if (typeof sp['tint'] === 'string') o.tint = sp['tint'] as string;
        on.fighter?.actor.afterimage(o);
        break;
      }
      case 'smear':
        on.fighter?.actor.smear(num('frames', 3));
        break;
      case 'shake':
        this.camera.shake(num('amount', 0.3));
        break;
      case 'speedlines':
        this.fx.speedLines({ frames: num('frames', 20), intensity: num('intensity', 0.7), angle: dir ? Math.atan2(dir.y, dir.x) : 0, focus: sp['focus'] ? at : null });
        break;
      case 'slowmo':
        this.slowMotion(num('scale', 0.3), num('frames', 40) / AUTHOR_FPS);
        break;
      case 'hitstop':
        for (const f of [on.fighter, on.target])
          if (f) {
            if (f.hitstop <= 0) f.actor.advanceSmear(2);
            f.hitstop = Math.max(f.hitstop, num('frames', 6));
            f.hitShake = num('shake', 4) * f.actor.scale;
          }
        break;
      default:
        this.emit('fx', { ...sp, fighter: on.fighter?.id, at });
        return;
    }
    this.emit('fx', { ...sp, fighter: on.fighter?.id, at });
  }

  /** Comando de câmera vindo de dados (`camera` de fase/onHit): shake, zoom, follow, pan, auto. */
  runCamera(c: Record<string, unknown>): void {
    const n = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : null);
    const secs = n('frames') !== null ? n('frames')! / AUTHOR_FPS : (n('seconds') ?? 0.4);
    if (n('shake') !== null) this.camera.shake(n('shake')!);
    if (n('zoom') !== null) this.camera.zoomTo(n('zoom')!, secs);
    if (typeof c['follow'] === 'string') this.camera.follow(c['follow']);
    if (Array.isArray(c['pan'])) this.camera.pan(Number(c['pan'][0]), Number(c['pan'][1]), secs);
    if (c['auto'] === true) this.camera.setAuto();
    this.emit('camera', c);
  }

  get clips(): Map<string, ClipData> {
    return this.options.clips ?? new Map();
  }

  on(event: string, fn: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  /** Todos os eventos, com o nome (o diretor de cena repassa e dispara os passos `on`). */
  onAny(fn: AnyListener): () => void {
    this.anyListeners.add(fn);
    return () => this.anyListeners.delete(fn);
  }

  private emit(event: string, payload: unknown): void {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
    for (const fn of this.anyListeners) fn(event, payload);
  }

  /** Acrescenta um personagem com os golpes dele (valida clipes, ações e ossos citados). */
  add(id: string, actor: Actor, moves: Map<string, MoveData> = new Map()): Fighter {
    if (this.fighters.has(id)) throw new Error(`fighter "${id}" repetido`);
    for (const move of moves.values()) {
      const src = `golpe ${actor.character.name}/${move.id}`;
      checkMovePoses(move, { attacker: actor.character.availablePoses(), base: actor.character.basePose ?? '' }, src);
      move.phases.forEach((ph, i) => {
        const clips = [ph.clip, i === 0 ? move.onHit?.targetClip : null, ph.spawn?.onHit?.targetClip].filter((c): c is string => !!c);
        for (const c of clips) if (!this.clips.has(c)) throw new DataError(src, `phases[${i}]`, `clipe "${c}" não carregado`);
        if (ph.run && !hasAction(ph.run)) throw new DataError(src, `phases[${i}].run`, `ação "${ph.run}" não registrada (registerAction)`);
      });
    }
    const f = new Fighter(id, actor, moves);
    this.fighters.set(id, f);
    return f;
  }

  fighter(id: string): Fighter {
    const f = this.fighters.get(id);
    if (!f) throw new Error(`fighter "${id}" não existe`);
    return f;
  }

  /**
   * Carrega antes as poses que os golpes usam (as do atacante e os `targetPose` nos outros
   * personagens). Pose que ninguém tem gera erro claro.
   */
  async prepare(): Promise<void> {
    for (const f of this.fighters.values())
      for (const move of f.moves.values()) {
        for (const p of move.poses) await f.actor.character.loadPose(p);
        const targetPoses = [move.onHit, ...move.phases.map((p) => p.spawn?.onHit ?? null)].map((h) => h?.targetPose).filter((p): p is string => !!p);
        for (const p of targetPoses) {
          const others = [...this.fighters.values()].filter((o) => o !== f && o.actor.character.availablePoses().has(p));
          // Sozinho em cena, o golpe não tem em quem acertar: nada a conferir.
          if (!others.length && this.fighters.size > 1) throw new DataError(`golpe ${f.actor.character.name}/${move.id}`, 'onHit.targetPose', `nenhum outro personagem tem a pose "${p}"`);
          for (const o of others) await o.actor.character.loadPose(p);
        }
      }
  }

  setMotion(id: string, motion: Motion | null): void {
    this.fighter(id).motion = motion;
  }

  addProp(prop: Prop): void {
    this.props.set(prop.id, prop);
  }
  removeProp(id: string): void {
    this.props.delete(id);
  }

  /**
   * Começa um golpe (cancela o que estiver em andamento). Golpes que atacam (hitbox ou projétil)
   * viram para o alvo; os outros (esquiva) mantêm a direção.
   */
  perform(id: string, moveId: string, targetId?: string): void {
    const f = this.fighter(id);
    const move = f.moves.get(moveId);
    if (!move) throw new Error(`${id} não tem o golpe "${moveId}"`);
    f.target = targetId ? this.fighter(targetId) : this.nearest(f);
    const attacks = move.phases.some((p) => p.hitboxes.length || p.spawn);
    if (f.target && attacks) f.actor.face(f.target.actor);
    f.runner = new MoveRunner(move);
    for (const e of f.runner.start()) this.enterPhase(f, e.phase);
    if (f.runner.finished) this.endMove(f);
  }

  private nearest(f: Fighter): Fighter | null {
    let best: Fighter | null = null, d = Infinity;
    for (const o of this.fighters.values()) {
      if (o === f) continue;
      const k = Math.hypot(o.actor.position.x - f.actor.position.x, o.actor.position.y - f.actor.position.y);
      if (k < d) [best, d] = [o, k];
    }
    return best;
  }

  private actionContext(f: Fighter, params: Record<string, unknown> = {}): ActionContext {
    return {
      self: f,
      params,
      target: f.target,
      scene: this,
      rng: this.rng,
      fx: this.fxApi(f),
      camera: {
        shake: (amount) => this.camera.shake(amount),
        zoom: (value, seconds) => this.camera.zoomTo(value, seconds),
        pan: (x, y, seconds) => this.camera.pan(x, y, seconds),
        follow: (id) => this.camera.follow(id),
        auto: () => this.camera.setAuto(),
      },
    };
  }

  /** API de efeitos para ações e roteiros (aceita Fighter ou o Actor dele). */
  fxApi(self: Fighter | null = null): FxApi {
    const fighterOf = (x: Fighter | Actor): Fighter | null => (x instanceof Fighter ? x : ([...this.fighters.values()].find((f) => f.actor === x) ?? null));
    const actorOf = (x: Fighter | Actor): Actor => (x instanceof Fighter ? x.actor : x);
    return {
      smear: (who, frames) => actorOf(who).smear(frames),
      afterimage: (who, options) => actorOf(who).afterimage(options),
      flash: (who, frames, color) => actorOf(who).flash(frames, color),
      impact: (at, options) => this.fx.impact(at, options),
      spark: (at, options) => this.fx.spark(at, options),
      speedLines: (options) => this.fx.speedLines(options),
      emit: (type, at, params) => this.runFx({ type, ...params }, { fighter: self, at: at ?? null }),
      run: (spec, on) => this.runFx(spec, { fighter: on && fighterOf(on) ? fighterOf(on) : self }),
    };
  }

  private enterPhase(f: Fighter, ph: PhaseSpec): void {
    const a = f.actor;
    if (ph.pose) a.setPose(ph.pose, ph.transition ? { transition: ph.transition } : {});
    if (ph.clip) a.play(this.clip(ph.clip), { restart: true, fade: 3 });
    if (ph.motion) {
      const m = ph.motion;
      if (m.type === 'dash') f.motion = dash({ x: m.velocity.x * a.facing, y: m.velocity.y }, { drag: m.drag });
      else if (m.type === 'stop') f.motion = new Hover();
      else f.overlay = { by: { x: m.by.x * a.facing, y: m.by.y }, ease: m.ease, frames: Math.max(1, ph.frames), t: 0, done: { x: 0, y: 0 } };
    }
    if (ph.aim <= 0) a.setReach('aim', null);
    if (ph.spawn) this.spawn(f, ph);
    if (ph.run) getAction(ph.run)!(this.actionContext(f, ph.runParams));
    for (const fx of ph.fx) this.runFx(fx, { fighter: f });
    if (ph.camera) this.runCamera(ph.camera);
    this.emit('phase', { fighter: f.id, move: f.runner?.move.id, phase: ph.name });
  }

  private spawn(f: Fighter, ph: PhaseSpec): void {
    const sp = ph.spawn!;
    const s = f.actor.sim;
    const bone = s.rig.byName.get(sp.from);
    if (bone === undefined) throw new Error(`spawn: osso "${sp.from}" não existe em ${f.actor.skinKey}`);
    const from = s.endWorld(bone);
    let dir: Vec2 = { x: f.actor.facing, y: 0 };
    if (sp.aim && f.target) {
      const c = f.target.center();
      const d = Math.hypot(c.x - from.x, c.y - from.y) || 1;
      dir = { x: (c.x - from.x) / d, y: (c.y - from.y) / d };
    }
    const p: Projectile = {
      id: this.nextProjectile++,
      kind: sp.projectile,
      owner: f.id,
      move: f.runner?.move.id ?? '',
      position: from,
      velocity: { x: dir.x * sp.speed, y: dir.y * sp.speed },
      radius: sp.radius * f.actor.scale,
      life: sp.life,
      onHit: sp.onHit ?? f.runner?.move.onHit ?? null,
      alive: true,
      warned: new Set(),
    };
    this.projectiles.push(p);
    this.emit('spawn', p);
    this.emit(`spawn:${f.id}`, p);
  }

  private endMove(f: Fighter): void {
    const move = f.runner?.move.id;
    f.runner = null;
    f.actor.setReach('aim', null);
    if (f.stun <= 0 && f.actor.poseName !== f.base) f.actor.setPose(f.base);
    this.emit('moveEnd', { fighter: f.id, move });
    this.emit(`moveEnd:${f.id}`, { fighter: f.id, move });
  }

  /** Reação automática do alvo a um contato. */
  private react(target: Fighter, facing: 1 | -1, onHit: OnHitSpec | null): void {
    if (!onHit) return;
    const a = target.actor;
    if (target.runner) {
      target.runner = null;
      a.setReach('aim', null);
    }
    target.overlay = null;
    if (onHit.targetPose && a.character.imagePoses.has(onHit.targetPose)) {
      a.setPose(onHit.targetPose, onHit.targetTransition ? { transition: onHit.targetTransition } : {});
      // No hitstop o borrão da reação congela já no 2º de 3 quadros (a pose nova domina o quadro parado).
      if (target.hitstop > 0) a.advanceSmear(2);
    }
    if (onHit.targetClip) a.play(this.clip(onHit.targetClip), { restart: true, fade: 2 });
    if (onHit.knockback.x || onHit.knockback.y) target.motion = knockback({ x: onHit.knockback.x * facing, y: onHit.knockback.y }, onHit.drag);
    target.stun = onHit.stun;
    if (target.stun <= 0) this.recover(target);
  }

  private recover(f: Fighter): void {
    f.stun = 0;
    if (f.actor.poseName !== f.base) f.actor.setPose(f.base);
    const idle = this.clips.get('idle_fly');
    if (idle) f.actor.play(idle, { fade: 10 });
  }

  private hit(e: Omit<HitEvent, 'time' | 'index'>): HitEvent {
    const ev: HitEvent = { ...e, time: this.time, index: this.hits.length + 1 };
    this.hits.push(ev);
    this.emit('hit', ev);
    this.emit(`hit:${e.attacker}->${e.target}`, ev);
    const atk = this.fighters.get(e.attacker) ?? null, tgt = this.fighters.get(e.target) ?? null;
    const dir = atk ? { x: atk.actor.facing, y: 0 } : null;
    for (const fx of e.onHit?.fx ?? []) this.runFx(fx, { fighter: atk, target: tgt, at: e.point, dir });
    if (e.onHit?.camera) this.runCamera(e.onHit.camera);
    // Hitstop: alvo (tremendo) e, no corpo a corpo, o atacante. Começa no próximo passo.
    const stop = e.onHit?.hitstop ?? 0;
    if (stop > 0) {
      if (tgt) {
        tgt.hitstop = Math.max(tgt.hitstop, stop);
        tgt.hitShake = 5 * tgt.actor.scale * Math.min(2, 0.6 + stop / 8);
      }
      if (atk && e.by === 'hitbox') {
        atk.hitstop = Math.max(atk.hitstop, stop);
        atk.hitShake = 0;
      }
    }
    return ev;
  }

  /** Um passo fixo (dt em tempo real; a câmera lenta escala a simulação). */
  step(realDt: number): void {
    const dt = realDt * this.timeScale; // escala no início do passo
    this.realTime += realDt;
    if (this.slow && this.realTime - this.slow.start >= this.slow.duration) this.slow = null;
    const df = dt * AUTHOR_FPS;
    for (const f of this.fighters.values()) {
      const a = f.actor;
      if (f.hitstop > 0) {
        // Congelado: nada anda (golpe, movimento, reação, borrão da troca de pose). Conta em tempo
        // real: na câmera lenta o congelamento não se arrasta.
        f.hitstop -= realDt * AUTHOR_FPS;
        a.hold(dt, f.hitShake);
        continue;
      }
      if (f.runner) {
        for (const e of f.runner.step(dt)) this.enterPhase(f, e.phase);
        if (f.runner?.finished) this.endMove(f);
      }
      // Mira (IK leve) no alvo durante as fases com "aim".
      const aim = f.runner?.phase.aim ?? 0;
      if (aim > 0 && f.target) a.setReach('aim', AIM_BONES, f.target.center(), 1, aim);

      if (f.motion) {
        if (f.motion.step(a, dt)) f.motion = null;
      } else a.velocity = { x: 0, y: 0 };
      if (f.overlay) {
        const o = f.overlay;
        o.t = Math.min(o.frames, o.t + df);
        const e = ease(o.ease, o.t / o.frames);
        const want = { x: o.by.x * e, y: o.by.y * e };
        a.velocity = { x: a.velocity.x + (want.x - o.done.x) / dt, y: a.velocity.y + (want.y - o.done.y) / dt };
        o.done = want;
        if (o.t >= o.frames) f.overlay = null;
      }
      if (f.stun > 0) {
        f.stun -= df;
        if (f.stun <= 0) this.recover(f);
      }
      a.step(dt);
      const pose = a.imagePose;
      f.hurtboxes = pose && a.opacity > 0 ? hurtboxesOf(a.sim, pose.hurtRadii) : [];
      f.hitboxes = [];
      for (const h of f.runner?.activeHitboxes ?? []) {
        const i = a.sim.rig.byName.get(h.bone);
        if (i === undefined) continue;
        const p = a.sim.pivotWorld(i), q = a.sim.endWorld(i);
        const lerp = (t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        f.hitboxes.push({ a: lerp(h.along[0]), b: lerp(h.along[1]), r: h.radius * a.scale });
      }
    }
    this.time += dt;

    // Golpes: hitbox × hurtbox, uma vez por alvo em cada fase ativa.
    for (const f of this.fighters.values()) {
      if (!f.hitboxes.length || !f.runner) continue;
      for (const t of this.fighters.values()) {
        if (t === f || f.runner.hitThisPhase.has(t.id)) continue;
        const contact = firstContact(f.hitboxes, t.hurtboxes);
        if (!contact) continue;
        f.runner.hitThisPhase.add(t.id);
        const ev = this.hit({ attacker: f.id, target: t.id, by: 'hitbox', move: f.runner.move.id, phase: f.runner.phase.name, point: contact, onHit: f.runner.move.onHit });
        this.react(t, f.actor.facing, ev.onHit);
      }
    }

    // Projéteis.
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.position.x += p.velocity.x * dt;
      p.position.y += p.velocity.y * dt;
      p.life -= df;
      if (p.life <= 0) p.alive = false;
      const shape = circle(p.position, p.radius);
      for (const t of this.fighters.values()) {
        if (!p.alive || t.id === p.owner) continue;
        if (!p.warned.has(t.id) && t.actor.opacity > 0) {
          // Aviso de chegada: perto e vindo na direção do alvo.
          const c = t.center();
          const dx = c.x - p.position.x, dy = c.y - p.position.y;
          if (dx * p.velocity.x + dy * p.velocity.y > 0 && Math.hypot(dx, dy) < (this.options.incomingDistance ?? 620)) {
            p.warned.add(t.id);
            this.emit(`incoming:${p.owner}->${t.id}`, { projectile: p.id, owner: p.owner, target: t.id, at: { ...p.position }, velocity: { ...p.velocity } });
          }
        }
        const contact = firstContact([shape], t.hurtboxes);
        if (!contact) continue;
        p.alive = false;
        const ev = this.hit({ attacker: p.owner, target: t.id, by: 'projectile', move: p.move, phase: null, point: contact, onHit: p.onHit });
        this.react(t, p.velocity.x >= 0 ? 1 : -1, ev.onHit);
      }
      for (const prop of this.props.values())
        if (p.alive && prop.solid && capsuleBoxHit(shape, prop.box)) {
          p.alive = false;
          const sp = Math.hypot(p.velocity.x, p.velocity.y) || 1;
          this.runFx({ type: 'spark', count: 8, size: 0.5 }, { at: { ...p.position }, dir: { x: -p.velocity.x / sp, y: -p.velocity.y / sp } });
        }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) if (!this.projectiles[i]!.alive) this.projectiles.splice(i, 1);
    this.fx.step(dt);

    // Corpo × prop sólido: um evento por encostada ("hit:door-><id>").
    for (const prop of this.props.values()) {
      if (!prop.solid) continue;
      for (const f of this.fighters.values()) {
        if (!f.collideProps) continue;
        const key = `${prop.id}|${f.id}`;
        let point: Vec2 | null = null;
        for (const h of f.hurtboxes) {
          const c = capsuleBoxHit(h, prop.box);
          if (c) {
            point = c.point;
            break;
          }
        }
        if (point && !this.propContacts.has(key)) {
          this.propContacts.add(key);
          this.hit({ attacker: prop.id, target: f.id, by: 'prop', move: null, phase: null, point, onHit: null });
        } else if (!point) this.propContacts.delete(key);
      }
    }
    this.stepCamera(realDt);
  }

  /** Câmera em tempo real: caixas dos personagens visíveis e dos props. */
  private stepCamera(dt: number): void {
    const { boxes, visible } = this.cameraTargets();
    this.camera.step(dt, boxes, visible);
  }

  /** Câmera direto no enquadramento-alvo do estado atual, sem suavizar (primeiro quadro, seek). */
  frameCamera(): void {
    const { boxes, visible } = this.cameraTargets();
    this.camera.frame(boxes, visible);
  }

  private cameraTargets(): { boxes: Map<string, Rect>; visible: string[] } {
    const boxes = new Map<string, Rect>();
    const visible: string[] = [];
    for (const f of this.fighters.values()) {
      boxes.set(f.id, f.actor.bounds());
      if (f.actor.opacity > 0) visible.push(f.id);
    }
    for (const p of this.props.values()) boxes.set(p.id, p.box);
    return { boxes, visible };
  }
}

function stripType(sp: FxSpec): Record<string, unknown> {
  const { type: _t, ...rest } = sp;
  return rest;
}

function firstContact(hitboxes: Capsule[], hurtboxes: Capsule[]): Vec2 | null {
  for (const h of hitboxes)
    for (const b of hurtboxes) {
      const c = capsuleHit(h, b);
      if (c) return c.point;
    }
  return null;
}

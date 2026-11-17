import { Animator, type PlayOptions } from './animator.js';
import { deformLBS, skinMatrices } from './deform.js';
import { defaultTransition, type Character, type PoseTransition, type SkinKind } from './character.js';
import type { ImagePose } from './image-pose.js';
import type { ClipData, RootSample } from './clip.js';
import { DEG, multiply, rotation, scaling, translation, type Mat2D, type Vec2 } from './math.js';
import { SpringChain, SquashStretch, aimTwoBone, hover, lookAt, rotateWorld } from './procedural.js';
import { createSprite, type CanvasRenderer, type DrawOptions, type Drawable, type Sprite } from './renderer.js';
import type { SolvedRig } from './rig.js';
import { Skeleton, type BonePose, type RootTransform } from './skeleton.js';

export interface ActorOptions {
  /** Flutuar parado (seno) e respirar. */
  hover?: boolean;
  /** Tecido com molas (as chains do rig). */
  cloth?: boolean;
  /** Esticar/achatar pela aceleração. */
  squash?: boolean;
  scale?: number;
  /**
   * Pose-imagem inicial deste actor (padrão: a atual do Character). Assim o diretor não mexe na
   * pose do Character, que pode estar em mais de uma cena ao mesmo tempo.
   */
  pose?: string;
}

interface Snapshot {
  bones: { rotation: number; ox: number; oy: number; scale: number; slot: string | null }[];
  root: RootTransform;
}

/** Tudo que depende do rig ativo: há um por skin/pose (o rig de peças e cada pose-imagem). */
interface SkinState {
  key: string;
  rig: SolvedRig;
  sim: Skeleton;
  view: Skeleton;
  animator: Animator;
  springs: SpringChain[];
  /** Limite de rotação por osso (rad), nas poses-imagem. */
  limits: Float32Array | null;
  /** Osso que cada um copia (poses-imagem; -1 = nenhum). */
  follow: Int16Array | null;
  /** Deslocamento da raiz (alinha a pose-imagem ao rig de peças). */
  anchor: Vec2;
  /** A pose-imagem (null no rig de peças). */
  image: ImagePose | null;
  prev: Snapshot | null;
  curr: Snapshot | null;
}

/** Duração de cada transição (frames de 60 fps). */
export const TRANSITION_FRAMES: Record<PoseTransition, number> = { cut: 0, flash: 4, afterimage: 10, smear: 3 };

/** Frames do borrão em cada troca de pose (toda troca, menos o `cut`, passa por ele). */
export const SMEAR_FRAMES = 3;

interface Transition {
  kind: PoseTransition;
  frames: number;
  t: number;
}

/**
 * Borrão (smear) entre a pose que sai e a atual, esticado no sentido do movimento: a antiga se
 * estica pra frente e some; a atual chega esticada, vinda de trás, e assenta.
 */
interface Smear {
  from: Skeleton;
  frames: number;
  t: number;
  dir: Vec2;
  /** Esticada máxima (0,3 = 30 % mais longo no sentido do movimento). */
  amount: number;
  /** Distância (mundo) de onde a pose nova vem. */
  reach: number;
}

/** Cópia translúcida (afterimage) que fica no mundo e some. */
interface Ghost {
  skeleton: Skeleton;
  /** Deslocamento inicial e deriva por frame (mundo). */
  offset: Vec2;
  drift: Vec2;
  life: number;
  age: number;
  alpha: number;
  tint: string | null;
}

export interface AfterimageOptions {
  /** Frames emitindo cópias (0 = só uma). */
  frames?: number;
  /** Uma cópia a cada N frames. */
  every?: number;
  /** Frames até cada cópia sumir. */
  life?: number;
  alpha?: number;
  /** Cor das cópias (ex.: "#7fc8ff"); null = cor original. */
  tint?: string | null;
}

const keyOf = (skin: SkinKind, pose: string) => (skin === 'parts' ? 'parts' : `image:${pose}`);

/**
 * Personagem em cena: corpo (posição/velocidade), clipes (Animator), camada procedural e
 * renderização interpolada entre dois passos fixos. Segue a skin/pose do Character (setSkin /
 * setPose), com a troca mascarada (cut, flash, afterimage, smear).
 */
export class Actor {
  position: Vec2 = { x: 0, y: 0 };
  velocity: Vec2 = { x: 0, y: 0 };
  /** Aceleração medida no último passo (px/s²). */
  acceleration: Vec2 = { x: 0, y: 0 };
  /** 1 = olhando pra direita, -1 = pra esquerda. */
  facing: 1 | -1 = 1;
  scale: number;
  options: Required<Omit<ActorOptions, 'scale' | 'pose'>>;
  /** Para onde a cabeça olha (null = pra frente). */
  lookTarget: Vec2 | null = null;
  lookLimit = 35 * DEG;
  /** Alvos de IK por membro (nomes de osso, valem em qualquer pose). */
  readonly reach = new Map<string, { bones: [string, string]; target: Vec2; bend: 1 | -1; weight: number }>();
  /** Opacidade (vanish/appear). */
  opacity = 1;
  /** Tempo de vida (s), para a flutuação. */
  time = 0;
  readonly squash = new SquashStretch();
  /** Transição de pose em andamento (informativo; o desenho vem dos efeitos abaixo). */
  transition: Transition | null = null;
  /** Trocas de pose/skin desde a criação (screenshots: "a N-ésima troca"). */
  poseChanges = 0;
  /**
   * Variantes escolhidas por tipo (expression, hand), na ordem da escolha: valem para toda pose que
   * tiver aquela variante carregada (a última escolhida tem prioridade).
   */
  private variantPick: { kind: string; name: string }[] = [];
  private smearFx: Smear | null = null;
  private readonly ghosts: Ghost[] = [];
  private trail: (Required<Omit<AfterimageOptions, 'tint'>> & { tint: string | null; acc: number }) | null = null;
  private flashFx: { color: string; frames: number; t: number } | null = null;
  /** Hitstop: frames congelado e o tremor do corpo (px do mundo). */
  private held = 0;
  private holdShake = 0;
  private sprite: Sprite | null = null;
  /** Esqueletos congelados (borrão, afterimages) já preparados: no Canvas 2D, um sprite só por pose congelada. */
  private frozen = new WeakMap<Skeleton, Drawable>();
  private readonly states = new Map<string, SkinState>();
  private state: SkinState;
  private lastVelocity: Vec2 = { x: 0, y: 0 };
  private readonly unsubscribe: () => void;

  constructor(
    readonly character: Character,
    options: ActorOptions = {},
  ) {
    this.scale = options.scale ?? 1;
    this.options = { hover: options.hover ?? true, cloth: options.cloth ?? true, squash: options.squash ?? true };
    this.state = options.pose ? this.stateFor('image', options.pose) : this.stateFor(character.skin, character.pose);
    this.unsubscribe = character.onSkinChange((c) => this.switchTo(c.skin, c.pose, c.transition));
  }

  /** Para de seguir as trocas do Character. */
  dispose(): void {
    this.unsubscribe();
  }

  get sim(): Skeleton {
    return this.state.sim;
  }
  get view(): Skeleton {
    return this.state.view;
  }
  get animator(): Animator {
    return this.state.animator;
  }
  get springs(): SpringChain[] {
    return this.state.springs;
  }
  /** "parts" ou "image:<pose>". */
  get skinKey(): string {
    return this.state.key;
  }
  /** Pose-imagem atual (null no rig de peças). */
  get imagePose(): ImagePose | null {
    return this.state.image;
  }
  /** Nome da pose atual ("parts" no rig de peças). */
  get poseName(): string {
    return this.state.image?.name ?? 'parts';
  }

  /**
   * Escolhe a variante de textura de um tipo (`null` volta à imagem da pose). Devolve se a pose
   * atual tem essa variante carregada; se não tiver, a pose atual continua como está.
   */
  setVariant(kind: string, name: string | null): boolean {
    this.variantPick = this.variantPick.filter((v) => v.kind !== kind);
    if (name) this.variantPick.push({ kind, name });
    return !name || this.character.variantPoses.has(`${this.poseName}@${name}`);
  }

  /** Variante desenhada agora (a escolhida que a pose atual tem) ou null. */
  get variantPose(): ImagePose | null {
    if (!this.state.image) return null;
    for (let i = this.variantPick.length - 1; i >= 0; i--) {
      const v = this.character.variantPoses.get(`${this.poseName}@${this.variantPick[i]!.name}`);
      if (v) return v;
    }
    return null;
  }

  /** Vira para um ponto (ou outro actor). */
  face(target: Vec2 | Actor): void {
    const x = 'position' in target ? target.position.x : target.x;
    if (x !== this.position.x) this.facing = x > this.position.x ? 1 : -1;
  }

  /** Troca só este actor (o Character.setSkin troca todos). */
  setSkin(skin: SkinKind, options: { transition?: PoseTransition } = {}): void {
    this.switchTo(skin, skin === 'image' ? this.character.pose : '', options.transition ?? 'smear');
  }

  setPose(name: string, options: { transition?: PoseTransition } = {}): void {
    if (name === 'parts') return this.setSkin('parts', options);
    this.switchTo('image', name, options.transition ?? defaultTransition(name, this.character.basePose));
  }

  private stateFor(skin: SkinKind, pose: string): SkinState {
    const key = keyOf(skin, pose);
    let st = this.states.get(key);
    if (st) return st;
    const rig = this.character.rigFor(skin, pose);
    const image = skin === 'image' ? this.character.imagePoses.get(pose)! : null;
    const limits = image ? image.limits : null;
    st = {
      key,
      rig,
      sim: new Skeleton(rig),
      view: new Skeleton(rig),
      animator: new Animator(rig),
      springs: rig.chains.map((c) => {
        // Na pose-imagem o tecido respeita o limite das correntes (±25°); no rig de peças, ±55°.
        const limit = limits ? Math.min(...c.bones.map((b) => limits[b]!)) : 55 * DEG;
        return new SpringChain(c.bones, { stiffness: c.stiffness, damping: c.damping, limit });
      }),
      limits,
      follow: image ? image.follow : null,
      anchor: image ? image.anchor : { x: 0, y: 0 },
      image,
      prev: null,
      curr: null,
    };
    this.states.set(key, st);
    return st;
  }

  private switchTo(skin: SkinKind, pose: string, transition: PoseTransition): void {
    const next = this.stateFor(skin, pose);
    const old = this.state;
    if (next === old) return;
    // Pose atual e clipe passam pelo nome do osso (os nomes são os mesmos em todas as poses).
    next.rig.bones.forEach((b, i) => {
      const j = old.rig.byName.get(b.name);
      const p = next.sim.pose[i]!;
      if (j === undefined) return;
      const q = old.sim.pose[j]!;
      p.rotation = q.rotation;
      p.offset = { ...q.offset };
      p.scale = q.scale;
    });
    next.animator.onEvent = old.animator.onEvent;
    for (const [name, pose] of old.animator.poses) if (!next.animator.poses.has(name) && next.rig.kind !== 'image') next.animator.poses.set(name, pose);
    const playing = old.animator.layer('base').current;
    if (playing) {
      try {
        next.animator.play(playing.clip, { fade: 0, restart: true, speed: playing.speed });
        next.animator.layer('base').current!.t = playing.t;
      } catch {
        /* clipe sem os ossos desta pose: começa do repouso */
      }
    }
    // A pose que sai, no último passo (o esqueleto de desenho pode estar parado, se a cena foi
    // simulada sem desenhar, como no seek). Congelada numa cópia: o borrão/rastro a desenha.
    this.applySnapshot(old, old.curr, old.curr, 1);
    const leaving = old.view.clone();
    for (const s of next.springs) s.reset();
    Object.assign(next.sim.root, old.sim.root);
    next.sim.update();
    next.prev = next.curr = this.snapshotOf(next);
    this.state = next;
    this.poseChanges++;
    this.transition = transition === 'cut' ? null : { kind: transition, frames: TRANSITION_FRAMES[transition], t: 0 };
    if (transition === 'cut') return;
    // Toda troca não-cut passa pelo borrão (nunca um quadro "estalado").
    this.smear(transition === 'flash' ? 2 : SMEAR_FRAMES, leaving);
    if (transition === 'afterimage') {
      // Volta: cópias da pose que saiu ficando pra trás.
      const d = this.motionDir(), u = 100 * this.scale;
      for (let k = 1; k <= 3; k++)
        this.ghosts.push({ skeleton: leaving, offset: { x: -d.x * u * 0.18 * k, y: -d.y * u * 0.18 * k }, drift: { x: -d.x * u * 0.05 * k, y: -d.y * u * 0.05 * k }, life: 10, age: 0, alpha: 0.55 - 0.12 * k, tint: null });
    } else if (transition === 'flash') this.flash(TRANSITION_FRAMES.flash, '#ffffff');
  }

  /** Direção do movimento (ou pra frente, parado). */
  private motionDir(): Vec2 {
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    return speed > 60 ? { x: this.velocity.x / speed, y: this.velocity.y / speed } : { x: this.facing, y: 0 };
  }

  /**
   * Borrão de `frames` quadros entre a pose anterior (`from`, padrão: a desenhada agora) e a
   * atual, esticado no sentido da velocidade. As trocas de pose usam; vale também sozinho
   * (sem troca, vira um borrão de movimento).
   */
  smear(frames = SMEAR_FRAMES, from?: Skeleton): void {
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    this.smearFx = {
      from: from ?? this.state.sim.clone(),
      frames: Math.max(1, frames),
      t: 0,
      dir: this.motionDir(),
      amount: 0.22 + Math.min(0.3, speed / 4000),
      reach: (60 + Math.min(120, speed * 0.06)) * this.scale,
    };
  }

  /** Adianta o borrão em andamento (frames), sem andar o resto. */
  advanceSmear(frames: number): void {
    if (this.smearFx) this.smearFx.t = Math.min(this.smearFx.t + frames, this.smearFx.frames - 0.01);
  }

  /** Cópias translúcidas da pose atual que ficam no mundo (dash, golpe rápido, sumiço). */
  afterimage(options: AfterimageOptions = {}): void {
    const o = { frames: options.frames ?? 0, every: options.every ?? 2, life: options.life ?? 12, alpha: options.alpha ?? 0.5, tint: options.tint ?? null };
    this.emitGhost(o.life, o.alpha, o.tint);
    this.trail = o.frames > 0 ? { ...o, acc: 0 } : null;
  }

  private emitGhost(life: number, alpha: number, tint: string | null): void {
    this.ghosts.push({ skeleton: this.state.sim.clone(), offset: { x: 0, y: 0 }, drift: { x: 0, y: 0 }, life, age: 0, alpha, tint });
    if (this.ghosts.length > 16) this.ghosts.shift();
  }

  /** Silhueta pintada de uma cor por `frames` quadros (impacto). Corre mesmo no hitstop. */
  flash(frames = 3, color = '#ffffff'): void {
    this.flashFx = { color, frames, t: 0 };
  }

  /**
   * Hitstop: um passo congelado. Nada anda (corpo, clipe, borrão, rastro); só o flash corre e o
   * corpo treme (`shake`, px do mundo).
   */
  hold(dt: number, shake = 0): void {
    const st = this.state;
    st.prev = st.curr;
    this.held += dt * 60;
    this.holdShake = shake;
    this.tickFlash(dt);
  }

  private tickFlash(dt: number): void {
    if (this.flashFx && (this.flashFx.t += dt * 60) >= this.flashFx.frames) this.flashFx = null;
  }

  play(clip: ClipData, options?: PlayOptions): void {
    this.animator.play(clip, options);
  }

  /** Mira um membro (ex.: braço da frente) num ponto do mundo; null solta. */
  setReach(name: string, bones: [string, string] | null, target?: Vec2, bend: 1 | -1 = 1, weight = 1): void {
    if (!bones || !target) {
      this.reach.delete(name);
      return;
    }
    this.sim.bone(bones[0]);
    this.sim.bone(bones[1]);
    this.reach.set(name, { bones, target, bend, weight });
  }

  /** Um passo fixo de simulação. */
  step(dt: number): void {
    this.time += dt;
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    // Aceleração suavizada (a mudança de velocidade num passo é ruidosa).
    const ax = (this.velocity.x - this.lastVelocity.x) / dt;
    const ay = (this.velocity.y - this.lastVelocity.y) / dt;
    this.acceleration.x += (ax - this.acceleration.x) * 0.25;
    this.acceleration.y += (ay - this.acceleration.y) * 0.25;
    this.lastVelocity = { ...this.velocity };
    const df = dt * 60;
    this.holdShake = 0;
    if (this.transition && (this.transition.t += df) >= this.transition.frames) this.transition = null;
    if (this.smearFx && (this.smearFx.t += df) >= this.smearFx.frames) this.smearFx = null;
    for (const g of this.ghosts) g.age += df;
    for (let i = this.ghosts.length - 1; i >= 0; i--) if (this.ghosts[i]!.age >= this.ghosts[i]!.life) this.ghosts.splice(i, 1);
    this.tickFlash(dt);

    const st = this.state;
    st.animator.advance(dt);
    const s = st.sim;
    const rootAnim = st.animator.apply(s.pose);
    this.placeRoot(rootAnim, dt);
    s.update();

    if (this.lookTarget) {
      const head = s.rig.byName.get('head');
      if (head !== undefined) lookAt(s, head, this.lookTarget, this.lookLimit, 0.8);
    }
    for (const r of this.reach.values()) {
      const upper = s.rig.byName.get(r.bones[0]), lower = s.rig.byName.get(r.bones[1]);
      if (upper !== undefined && lower !== undefined) aimTwoBone(s, upper, lower, r.target, r.bend, r.weight);
    }
    if (this.options.cloth) for (const spring of st.springs) spring.step(s, dt);
    if (st.limits) {
      // Membros sobrepostos no desenho giram juntos ("follow").
      st.follow!.forEach((lead, i) => {
        if (lead >= 0) s.pose[i]!.rotation = s.pose[lead]!.rotation;
      });
      // Pose-imagem: a figura só aguenta giros pequenos sem deformar (membros ±12°, tecido ±25°).
      s.pose.forEach((p, i) => {
        const l = st.limits![i]!;
        p.rotation = Math.max(-l, Math.min(l, p.rotation));
      });
      s.update();
    }

    st.prev = st.curr;
    st.curr = this.snapshotOf(st);
    st.prev ??= st.curr;
    if (this.trail) {
      const tr = this.trail;
      tr.acc += df;
      tr.frames -= df;
      if (tr.acc >= tr.every) {
        tr.acc -= tr.every;
        this.emitGhost(tr.life, tr.alpha, tr.tint);
      }
      if (tr.frames <= 0) this.trail = null;
    }
  }

  private placeRoot(anim: RootSample, dt: number, squash = this.options.squash): void {
    const s = this.state.sim;
    const r = s.root;
    const fx = this.facing;
    const h = this.options.hover ? hover(this.time) : { y: 0, rot: 0 };
    // Respiração: um sobe-e-desce bem leve da escala vertical.
    const breath = this.options.hover ? 1 + 0.012 * Math.sin((2 * Math.PI * this.time) / 3.2) : 1;
    const anchor = this.state.anchor;
    // Pose provisória: variação fixa na raiz (a mesma imagem de outra pose, girada/achatada).
    const v = this.state.image?.provisional;
    r.x = this.position.x + (anim.x + anchor.x * this.scale + (v?.dx ?? 0) * this.scale) * fx;
    r.y = this.position.y + anim.y + h.y + (anchor.y + (v?.dy ?? 0)) * this.scale;
    r.rotation = anim.rot + h.rot + (v ? v.rotate * DEG : 0);
    r.flip = fx < 0;
    r.scale = this.scale;
    r.sx = anim.sx * (v?.sx ?? 1);
    r.sy = anim.sy * breath * (v?.sy ?? 1);
    if (squash) {
      this.squash.step(this.velocity, this.acceleration, dt);
      r.stretch = this.squash.amount;
      r.stretchAngle = this.squash.angle;
    } else r.stretch = 0;
    // Inclina o tronco na direção da velocidade vertical (sobe → nariz pra cima).
    const torso = s.rig.byName.get('torso');
    if (torso !== undefined) rotateWorld(s, torso, Math.max(-0.25, Math.min(0.25, this.velocity.y * 0.0004)) * fx);
  }

  /**
   * Põe o esqueleto no estado atual (posição, lado, escala, pose e clipe no instante atual) sem andar
   * o tempo: sem mola, squash ou rastro. É o que o primeiro quadro desenha (antes do primeiro passo
   * o esqueleto ainda estaria na origem) e o que a câmera enquadra no início.
   */
  settle(): void {
    const st = this.state;
    const s = st.sim;
    this.placeRoot(st.animator.apply(s.pose), 0, false);
    s.root.stretch = 0;
    s.update();
    if (st.limits) {
      st.follow!.forEach((lead, i) => {
        if (lead >= 0) s.pose[i]!.rotation = s.pose[lead]!.rotation;
      });
      s.pose.forEach((p, i) => {
        const l = st.limits![i]!;
        p.rotation = Math.max(-l, Math.min(l, p.rotation));
      });
      s.update();
    }
    st.curr = this.snapshotOf(st);
    st.prev = st.curr;
  }

  private snapshotOf(st: SkinState): Snapshot {
    return {
      bones: st.sim.pose.map((p: BonePose) => ({ rotation: p.rotation, ox: p.offset.x, oy: p.offset.y, scale: p.scale, slot: p.slot })),
      root: { ...st.sim.root },
    };
  }

  /** Atualiza o esqueleto de desenho interpolando entre os dois últimos passos. */
  interpolate(alpha: number): Skeleton {
    const st = this.state;
    return this.applySnapshot(st, st.prev, st.curr, alpha) ?? st.sim;
  }

  private applySnapshot(st: SkinState, a: Snapshot | null, b: Snapshot | null, alpha: number): Skeleton | null {
    if (!a || !b) return null;
    const v = st.view;
    const lerp = (x: number, y: number) => x + (y - x) * alpha;
    b.bones.forEach((bb, i) => {
      const ab = a.bones[i]!;
      const p = v.pose[i]!;
      p.rotation = lerp(ab.rotation, bb.rotation);
      p.offset = { x: lerp(ab.ox, bb.ox), y: lerp(ab.oy, bb.oy) };
      p.scale = lerp(ab.scale, bb.scale);
      p.slot = bb.slot;
    });
    Object.assign(v.root, b.root, {
      x: lerp(a.root.x, b.root.x),
      y: lerp(a.root.y, b.root.y),
      rotation: lerp(a.root.rotation, b.root.rotation),
      stretch: lerp(a.root.stretch, b.root.stretch),
      sx: lerp(a.root.sx, b.root.sx),
      sy: lerp(a.root.sy, b.root.sy),
    });
    v.update();
    return v;
  }

  /** Caixa do corpo no mundo, no último passo (a malha deformada; no rig de peças, os ossos). */
  bounds(): { x: number; y: number; w: number; h: number } {
    const s = this.state.sim;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x: number, y: number) => {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    };
    const pose = this.state.image;
    if (pose) {
      const mats = skinMatrices(s, pose.restInverse);
      const d = deformLBS(pose.mesh, mats, pose.origin);
      for (let i = 0; i < d.length; i += 2) add(d[i]!, d[i + 1]!);
    } else {
      const pad = 60 * this.scale;
      s.rig.bones.forEach((_, i) => {
        const a = s.pivotWorld(i), b = s.endWorld(i);
        add(a.x - pad, a.y - pad);
        add(b.x + pad, b.y + pad);
      });
    }
    if (!Number.isFinite(x0)) return { x: this.position.x, y: this.position.y, w: 0, h: 0 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** Borrão em andamento (frame atual e total) ou null. */
  get smearing(): { t: number; frames: number } | null {
    return this.smearFx ? { t: this.smearFx.t, frames: this.smearFx.frames } : null;
  }
  /** Cópias (afterimage) vivas. */
  get ghostCount(): number {
    return this.ghosts.length;
  }
  /** Flash em andamento ou null. */
  get flashing(): { color: string; t: number; frames: number } | null {
    return this.flashFx ? { ...this.flashFx } : null;
  }


  /**
   * Desenha o personagem: primeiro as cópias (afterimage), depois o corpo. Durante o borrão, a
   * pose que sai se estica pra frente e some enquanto a atual chega esticada de trás. Cada pose
   * é renderizada uma vez num sprite; as cópias são só esse bitmap (barato no Canvas 2D).
   */
  draw(renderer: CanvasRenderer, alpha: number, options: DrawOptions = {}): void {
    renderer.batch(() => this.drawAll(renderer, alpha, options));
  }

  private drawAll(renderer: CanvasRenderer, alpha: number, options: DrawOptions): void {
    const ch = this.character;
    // Cópias congeladas: no Canvas 2D o sprite é capturado uma vez e reaproveitado.
    const keep = (skeleton: Skeleton) => {
      let d = this.frozen.get(skeleton);
      if (!d || (!d.sprite && !renderer.webGL)) this.frozen.set(skeleton, (d = renderer.prepare(skeleton, ch, createSprite())));
      return d;
    };
    for (const g of this.ghosts) {
      const k = 1 - g.age / g.life;
      if (k <= 0) continue;
      renderer.drawPrepared(keep(g.skeleton), {
        alpha: g.alpha * k * k * (options.alpha ?? 1),
        offset: { x: g.offset.x + g.drift.x * g.age, y: g.offset.y + g.drift.y * g.age },
        flash: g.tint ? { color: g.tint, amount: 0.65 } : null,
      });
    }
    if (this.opacity <= 0) return;
    const base = (options.alpha ?? 1) * this.opacity;
    const sm = this.smearFx;
    const current = renderer.prepare(this.interpolate(alpha), ch, (this.sprite ??= createSprite()), !!sm, this.variantPose ?? undefined);
    const fl = this.flashFx;
    const flash = fl ? { color: fl.color, amount: Math.max(options.flash?.amount ?? 0, 1 - fl.t / Math.max(1, fl.frames)) } : options.flash;
    const shake = this.holdShake ? (Math.floor(this.held / 2) % 2 ? 1 : -1) * this.holdShake : 0;
    const off = { x: (options.offset?.x ?? 0) + shake, y: options.offset?.y ?? 0 };
    if (!sm) return renderer.drawPrepared(current, { ...options, alpha: base, offset: off, flash });
    const p = Math.min(1, sm.t / sm.frames);
    const angle = Math.atan2(sm.dir.y, sm.dir.x);
    const r = current.skeleton.root;
    const at = { x: r.x, y: r.y };
    // Rastro da nova, vindo de trás.
    for (let k = 2; k >= 1; k--) {
      const back = sm.reach * (1 - p) * (k / 2);
      renderer.drawPrepared(current, {
        alpha: base * 0.3 * (1 - p),
        transform: stretchAbout(at, angle, sm.amount * (1 - p) * 1.3),
        offset: { x: off.x - sm.dir.x * back, y: off.y - sm.dir.y * back },
      });
    }
    // A nova, sólida: entra esticada e assenta (o quadro de borrão continua opaco, sem "fantasma").
    const back = sm.reach * 0.25 * (1 - p);
    renderer.drawPrepared(current, {
      alpha: base,
      transform: stretchAbout(at, angle, sm.amount * (1 - p)),
      offset: { x: off.x - sm.dir.x * back, y: off.y - sm.dir.y * back },
      flash,
    });
    // A que sai, por cima: estica pra frente e some.
    renderer.drawPrepared(keep(sm.from), {
      alpha: base * 0.75 * (1 - p) * (1 - p),
      transform: stretchAbout(at, angle, sm.amount * (0.5 + p)),
      offset: { x: off.x + sm.dir.x * sm.reach * 0.3 * p, y: off.y + sm.dir.y * sm.reach * 0.3 * p },
    });
  }
}

/** Estica (preservando a área) ao longo de `angle`, em volta de `at` (mundo). */
function stretchAbout(at: Vec2, angle: number, amount: number): Mat2D {
  const s = 1 + amount;
  return multiply(multiply(multiply(multiply(translation(at.x, at.y), rotation(angle)), scaling(s, 1 / s)), rotation(-angle)), translation(-at.x, -at.y));
}

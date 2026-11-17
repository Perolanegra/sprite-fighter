import type { PoseTransition } from './character.js';
import { EASE_NAMES, type EaseName } from './easing.js';
import { AUTHOR_FPS } from './loop.js';
import type { Vec2 } from './math.js';
import { DataError, Reader } from './validate.js';

/**
 * Golpe em fases (`assets/moves/<char>.moves.json` = lista de golpes). Tempo em frames de 60 fps.
 *
 *   { "id": "jab", "poses": ["punch"],
 *     "phases": [
 *       { "name": "preparo", "frames": 4, "pose": "punch" },
 *       { "name": "ativo", "frames": 5, "hitboxes": [{ "bone": "hand_front", "radius": 34 }] },
 *       { "name": "volta", "frames": 10, "pose": "fly" } ],
 *     "onHit": { "hitstop": 6, "knockback": [260, 0], "targetPose": "hurt", "targetClip": "hurt_light" } }
 *
 * `pose` troca a pose-chave na entrada da fase (sem `transition`: smear ao sair da pose base,
 * afterimage ao voltar). Toda pose usada precisa estar em `poses` (ou ser a pose base).
 */

export interface HitboxSpec {
  bone: string;
  /** Raio (px do mundo, multiplicado pela escala do actor). */
  radius: number;
  /** Trecho do osso coberto (0 = articulação, 1 = ponta). Padrão [0, 1]. */
  along: [number, number];
}

export type MotionSpec =
  | { type: 'dash'; velocity: Vec2; drag: number }
  | { type: 'offset'; by: Vec2; ease: EaseName }
  | { type: 'stop' };

export interface SpawnSpec {
  projectile: string;
  /** Osso de onde sai (a ponta do osso). */
  from: string;
  speed: number;
  radius: number;
  /** Vida (frames). */
  life: number;
  /** Mirar no alvo (senão, reto pra frente). */
  aim: boolean;
  onHit: OnHitSpec | null;
}

export interface OnHitSpec {
  /** Frames de congelamento (executado na Fase 5; aqui é emitido no evento). */
  hitstop: number;
  /** Velocidade do recuo do alvo (px/s; x no sentido do atacante). */
  knockback: Vec2;
  /** Arrasto do recuo (1/s). */
  drag: number;
  /** Frames até o alvo voltar à pose base. */
  stun: number;
  targetPose: string | null;
  targetTransition: PoseTransition | null;
  targetClip: string | null;
  fx: FxSpec[];
  camera: Record<string, unknown> | null;
}

/** Efeito (nome ou objeto com `type`); a Fase 5 desenha. */
export type FxSpec = { type: string } & Record<string, unknown>;

export interface PhaseSpec {
  name: string;
  frames: number;
  pose: string | null;
  transition: PoseTransition | null;
  clip: string | null;
  fx: FxSpec[];
  camera: Record<string, unknown> | null;
  spawn: SpawnSpec | null;
  hitboxes: HitboxSpec[];
  /** Ação TS registrada (`registerAction`) chamada na entrada da fase. */
  run: string | null;
  /** Parâmetros da ação (`"run": { "action": "<nome>", "params": { … } }`). */
  runParams: Record<string, unknown>;
  motion: MotionSpec | null;
  /** IK do braço da frente mirando o alvo durante a fase (0 = solto). */
  aim: number;
}

export interface MoveData {
  id: string;
  poses: string[];
  phases: PhaseSpec[];
  onHit: OnHitSpec | null;
  /** Total de frames. */
  frames: number;
}

const TRANSITIONS = ['afterimage', 'flash', 'smear', 'cut'] as const;

const vec = (r: Reader): Vec2 => {
  const [x, y] = r.pair();
  return { x, y };
};

function parseFx(r: Reader): FxSpec[] {
  if (!r.present) return [];
  return r.array().map((f) => (typeof f.value === 'string' ? { type: f.string() } : { ...(f.object() as object), type: f.at('type').string() }));
}

function parseOnHit(r: Reader): OnHitSpec | null {
  if (!r.present) return null;
  r.object();
  return {
    hitstop: r.at('hitstop').optNumber(0),
    knockback: r.at('knockback').present ? vec(r.at('knockback')) : { x: 0, y: 0 },
    drag: r.at('drag').optNumber(4),
    stun: r.at('stun').optNumber(20),
    targetPose: r.at('targetPose').optString() ?? null,
    targetTransition: r.at('targetTransition').present ? r.at('targetTransition').oneOf(TRANSITIONS) : null,
    targetClip: r.at('targetClip').optString() ?? null,
    fx: parseFx(r.at('fx')),
    camera: r.at('camera').present ? (r.at('camera').object() as Record<string, unknown>) : null,
  };
}

/** `"run": "<ação>"` ou `"run": { "action": "<ação>", "params": { … } }`. */
function parseRun(r: Reader): { run: string | null; runParams: Record<string, unknown> } {
  if (!r.present) return { run: null, runParams: {} };
  if (typeof r.value === 'string') return { run: r.string(), runParams: {} };
  r.object();
  return { run: r.at('action').string(), runParams: r.at('params').present ? { ...(r.at('params').object() as Record<string, unknown>) } : {} };
}

function parseMotion(r: Reader): MotionSpec | null {
  if (!r.present) return null;
  const type = r.at('type').oneOf(['dash', 'offset', 'stop'] as const);
  if (type === 'dash') return { type, velocity: vec(r.at('velocity')), drag: r.at('drag').optNumber(6) };
  if (type === 'offset') return { type, by: vec(r.at('by')), ease: r.at('ease').oneOf(EASE_NAMES, 'cubicOut') };
  return { type };
}

export function parseMove(json: unknown, source = 'golpe'): MoveData {
  const r = new Reader(source, json);
  r.object();
  const id = r.at('id').string();
  const poses = r.at('poses').present ? r.at('poses').array().map((p) => p.string()) : [];
  const phases = r.at('phases').array().map((p): PhaseSpec => {
    p.object();
    const frames = p.at('frames').number();
    if (frames < 0) p.at('frames').fail('não pode ser negativo');
    const pose = p.at('pose').optString() ?? null;
    const sp = p.at('spawn');
    return {
      name: p.at('name').string(),
      frames,
      pose,
      transition: p.at('transition').present ? p.at('transition').oneOf(TRANSITIONS) : null,
      clip: p.at('clip').optString() ?? null,
      fx: parseFx(p.at('fx')),
      camera: p.at('camera').present ? (p.at('camera').object() as Record<string, unknown>) : null,
      spawn: sp.present
        ? {
            projectile: sp.at('projectile').string(),
            from: sp.at('from').string(),
            speed: sp.at('speed').optNumber(1600),
            radius: sp.at('radius').optNumber(12),
            life: sp.at('life').optNumber(90),
            aim: sp.at('aim').present ? sp.at('aim').value === true : true,
            onHit: parseOnHit(sp.at('onHit')),
          }
        : null,
      hitboxes: p.at('hitboxes').present
        ? p.at('hitboxes').array().map((h) => ({
            bone: h.at('bone').string(),
            radius: h.at('radius').number(),
            along: h.at('along').present ? h.at('along').pair() : [0, 1],
          }))
        : [],
      ...parseRun(p.at('run')),
      motion: parseMotion(p.at('motion')),
      aim: p.at('aim').optNumber(0),
    };
  });
  if (!phases.length) r.at('phases').fail('o golpe precisa de pelo menos uma fase');
  return { id, poses, phases, onHit: parseOnHit(r.at('onHit')), frames: phases.reduce((s, p) => s + p.frames, 0) };
}

/** Lista de golpes de um personagem (ids únicos). */
export function parseMoves(json: unknown, source = 'golpes'): Map<string, MoveData> {
  const r = new Reader(source, json);
  const moves = new Map<string, MoveData>();
  r.array().forEach((m, i) => {
    const move = parseMove(m.value, `${source}[${i}]`);
    if (moves.has(move.id)) m.at('id').fail(`golpe "${move.id}" repetido`);
    moves.set(move.id, move);
  });
  return moves;
}

/**
 * Confere as poses de um golpe: cada `pose` de fase (e `targetPose`) precisa estar em `poses`
 * (ou ser a pose base), e toda pose de `poses` precisa existir no personagem (`available`: as
 * poses do índice e as provisórias). Erro claro na carga.
 */
export function checkMovePoses(move: MoveData, available: { attacker: Set<string>; base: string; target?: Set<string> }, source = `golpe ${move.id}`): void {
  for (const p of move.poses)
    if (!available.attacker.has(p)) throw new DataError(source, 'poses', `pose "${p}" não existe no personagem (nem como provisória no índice)`);
  move.phases.forEach((ph, i) => {
    if (ph.pose && ph.pose !== available.base && !move.poses.includes(ph.pose))
      throw new DataError(source, `phases[${i}].pose`, `"${ph.pose}" não está em "poses" do golpe`);
  });
  const onHits = [move.onHit, ...move.phases.map((p) => p.spawn?.onHit ?? null)];
  if (available.target)
    for (const h of onHits)
      if (h?.targetPose && !available.target.has(h.targetPose)) throw new DataError(source, 'onHit.targetPose', `o alvo não tem a pose "${h.targetPose}"`);
}

/** Evento do sequenciador: entrou numa fase. */
export interface PhaseEnter {
  index: number;
  phase: PhaseSpec;
}

/**
 * Sequenciador de fases: avança em frames de 60 fps a partir de `dt` (s). Puro; o World executa o
 * que cada fase pede (pose, clipe, movimento, spawn, ação) ao receber a entrada da fase.
 */
export class MoveRunner {
  index = 0;
  /** Frame dentro da fase atual. */
  frame = 0;
  finished = false;
  /** Alvos já acertados nesta fase (onHit uma vez por fase ativa). */
  readonly hitThisPhase = new Set<string>();

  constructor(readonly move: MoveData) {}

  get phase(): PhaseSpec {
    return this.move.phases[Math.min(this.index, this.move.phases.length - 1)]!;
  }

  /** Hitboxes valem só enquanto a fase atual está rodando. */
  get activeHitboxes(): HitboxSpec[] {
    return this.finished ? [] : this.phase.hitboxes;
  }

  /** Entrada da primeira fase (e das de 0 frames logo depois). */
  start(): PhaseEnter[] {
    const out: PhaseEnter[] = [{ index: 0, phase: this.move.phases[0]! }];
    this.skipEmpty(out);
    return out;
  }

  /** Avança `dt` s; devolve as fases em que entrou. */
  step(dt: number): PhaseEnter[] {
    const out: PhaseEnter[] = [];
    if (this.finished) return out;
    this.frame += dt * AUTHOR_FPS;
    // Tolerância: 120 Hz soma 0,5 frame por passo; evita perder a borda por arredondamento.
    while (!this.finished && this.frame >= this.phase.frames - 1e-9) {
      this.frame -= this.phase.frames;
      this.advance(out);
    }
    return out;
  }

  private advance(out: PhaseEnter[]): void {
    this.hitThisPhase.clear();
    if (this.index + 1 >= this.move.phases.length) {
      this.finished = true;
      this.frame = 0;
      return;
    }
    this.index++;
    out.push({ index: this.index, phase: this.phase });
  }

  private skipEmpty(out: PhaseEnter[]): void {
    while (!this.finished && this.phase.frames === 0) this.advance(out);
  }
}

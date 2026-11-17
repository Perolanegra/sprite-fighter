import { EASE_NAMES, ease, type EaseName } from './easing.js';
import { deg2rad } from './math.js';
import type { SolvedRig } from './rig.js';
import { DataError, Reader } from './validate.js';

/**
 * Clipe de animação (`clips/<id>.json`), em frames de 60 fps:
 *
 *   {
 *     "id": "idle_fly", "loop": true, "frames": 90,
 *     "bones": { "head": [ { "f": 0, "rot": 0 }, { "f": 45, "rot": -4, "ease": "sineInOut" } ] },
 *     "slots": { "head": [ { "f": 0, "slot": "head_shout" }, { "f": 20, "slot": "default" } ] },
 *     "pose": "fly_rest",
 *     "root":  [ { "f": 0, "y": 0 }, { "f": 45, "y": -8, "ease": "sineInOut" } ],
 *     "events": [ { "frame": 6, "event": "hitbox:on" } ]
 *   }
 *
 * Ossos: `rot` (graus, somado ao repouso), `x`/`y` (deslocamento no espaço da mãe), `scale`.
 * Raiz (o corpo todo, visual): `x`, `y`, `rot` (graus), `sx`, `sy` (esticar/achatar).
 * O `ease` de uma chave vale para o trecho que chega nela. Canais ausentes ficam no repouso.
 * `"slot": "default"` volta à peça padrão do osso.
 * `"pose"`: pose nomeada do personagem (poses/<char>/<nome>.json) somada por baixo das chaves.
 */
export interface Key {
  f: number;
  v: number;
  ease: EaseName;
}

export const BONE_CHANNELS = ['rot', 'x', 'y', 'scale'] as const;
export const ROOT_CHANNELS = ['x', 'y', 'rot', 'sx', 'sy'] as const;
export type BoneChannel = (typeof BONE_CHANNELS)[number];
export type RootChannel = (typeof ROOT_CHANNELS)[number];

export interface ClipData {
  id: string;
  loop: boolean;
  /** Duração em frames de 60 fps. */
  frames: number;
  /** Pose base (por personagem) somada por baixo do clipe. */
  pose?: string;
  bones: Map<string, Partial<Record<BoneChannel, Key[]>>>;
  slots: Map<string, { f: number; slot: string }[]>;
  root: Partial<Record<RootChannel, Key[]>>;
  events: { frame: number; event: string }[];
}

const DEFAULTS: Record<BoneChannel | RootChannel, number> = { rot: 0, x: 0, y: 0, scale: 1, sx: 1, sy: 1 };

function readTrack<C extends string>(r: Reader, channels: readonly C[]): Partial<Record<C, Key[]>> {
  const out: Partial<Record<C, Key[]>> = {};
  let last = -Infinity;
  for (const k of r.array()) {
    k.object();
    const f = k.at('f').number();
    if (f < last) k.at('f').fail('as chaves precisam estar em ordem de frame');
    last = f;
    const easeName = k.at('ease').oneOf(EASE_NAMES, 'linear');
    let any = false;
    for (const c of channels) {
      if (!k.at(c).present) continue;
      any = true;
      (out[c] ??= []).push({ f, v: k.at(c).number(), ease: easeName });
    }
    const unknown = Object.keys(k.object()).filter((key) => key !== 'f' && key !== 'ease' && !channels.includes(key as C));
    if (unknown.length) k.fail(`canal desconhecido: ${unknown.join(', ')} (use ${channels.join(', ')})`);
    if (!any) k.fail(`chave sem nenhum canal (${channels.join(', ')})`);
  }
  return out;
}

export function parseClip(json: unknown, source = 'clip'): ClipData {
  const r = new Reader(source, json);
  r.object();
  const id = r.at('id').string();
  const bones = new Map<string, Partial<Record<BoneChannel, Key[]>>>();
  if (r.at('bones').present) for (const name of Object.keys(r.at('bones').object())) bones.set(name, readTrack(r.at('bones').at(name), BONE_CHANNELS));
  const slots = new Map<string, { f: number; slot: string }[]>();
  if (r.at('slots').present)
    for (const name of Object.keys(r.at('slots').object()))
      slots.set(
        name,
        r.at('slots').at(name).array().map((k) => ({ f: k.at('f').number(), slot: k.at('slot').string() })),
      );
  const root = r.at('root').present ? readTrack(r.at('root'), ROOT_CHANNELS) : {};
  const events = r.at('events').present ? r.at('events').array().map((e) => ({ frame: e.at('frame').number(), event: e.at('event').string() })) : [];
  let lastKey = 0;
  for (const track of [...bones.values(), root]) for (const keys of Object.values(track) as Key[][]) lastKey = Math.max(lastKey, keys.at(-1)?.f ?? 0);
  for (const keys of slots.values()) lastKey = Math.max(lastKey, keys.at(-1)?.f ?? 0);
  // Uma chave só (pose parada) dura 1 frame.
  const frames = r.at('frames').optNumber(Math.max(lastKey, 1));
  if (frames <= 0) r.at('frames').fail('a duração precisa ser > 0');
  const pose = r.at('pose').optString();
  return { id, loop: r.at('loop').present ? r.at('loop').value === true : false, frames, ...(pose ? { pose } : {}), bones, slots, root, events };
}

/** Confere o clipe contra um rig: ossos existentes e slots que o osso tem. */
export function checkClip(clip: ClipData, rig: SolvedRig): void {
  const fail = (path: string, detail: string): never => {
    throw new DataError(`clip ${clip.id} (${rig.char})`, path, detail);
  };
  for (const name of clip.bones.keys()) if (!rig.byName.has(name)) fail(`bones.${name}`, `osso "${name}" não existe no rig`);
  // Pose-imagem não tem slots: as trilhas de slot simplesmente não fazem nada nela.
  if (rig.kind === 'image') return;
  for (const [name, keys] of clip.slots) {
    const i = rig.byName.get(name);
    if (i === undefined) fail(`slots.${name}`, `osso "${name}" não existe no rig`);
    const bone = rig.bones[i!]!;
    for (const k of keys)
      if (k.slot !== 'default' && k.slot !== 'none' && !bone.slots.includes(k.slot))
        fail(`slots.${name}`, `"${k.slot}" não é slot do osso (slots: ${bone.slots.join(', ') || 'nenhum'})`);
  }
}

/** Valor de um canal no frame `f` (fora das chaves, segura o valor da ponta). */
export function sampleKeys(keys: Key[] | undefined, f: number, fallback: number): number {
  if (!keys?.length) return fallback;
  if (f <= keys[0]!.f) return keys[0]!.v;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (f <= b.f) {
      const a = keys[i - 1]!;
      const span = b.f - a.f;
      const t = span > 0 ? ease(b.ease, (f - a.f) / span) : 1;
      return a.v + (b.v - a.v) * t;
    }
  }
  return keys.at(-1)!.v;
}

/** Valores de um osso (rotação em rad). */
export interface BoneSample {
  rot: number;
  x: number;
  y: number;
  scale: number;
}

export interface RootSample {
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
}

export const restBone = (): BoneSample => ({ rot: 0, x: 0, y: 0, scale: 1 });
export const restRoot = (): RootSample => ({ x: 0, y: 0, rot: 0, sx: 1, sy: 1 });

/** Frame local do clipe para um tempo corrido em frames (loop dá a volta; sem loop, para no fim). */
export function clipFrame(clip: ClipData, t: number): number {
  if (clip.loop) return ((t % clip.frames) + clip.frames) % clip.frames;
  return Math.min(t, clip.frames);
}

export function sampleBone(clip: ClipData, bone: string, f: number): BoneSample | null {
  const track = clip.bones.get(bone);
  if (!track) return null;
  return {
    rot: deg2rad(sampleKeys(track.rot, f, DEFAULTS.rot)),
    x: sampleKeys(track.x, f, DEFAULTS.x),
    y: sampleKeys(track.y, f, DEFAULTS.y),
    scale: sampleKeys(track.scale, f, DEFAULTS.scale),
  };
}

export function sampleRoot(clip: ClipData, f: number): RootSample {
  const r = clip.root;
  return {
    x: sampleKeys(r.x, f, 0),
    y: sampleKeys(r.y, f, 0),
    rot: deg2rad(sampleKeys(r.rot, f, 0)),
    sx: sampleKeys(r.sx, f, 1),
    sy: sampleKeys(r.sy, f, 1),
  };
}

/** Slot ativo no frame `f` (a última troca até ali), ou undefined se o clipe não mexe nesse osso. */
export function sampleSlot(clip: ClipData, bone: string, f: number): string | undefined {
  const keys = clip.slots.get(bone);
  if (!keys?.length) return undefined;
  let slot: string | undefined;
  for (const k of keys) if (k.f <= f) slot = k.slot;
  return slot ?? keys[0]!.slot;
}

/** Eventos cruzados ao andar de `from` até `to` (frames corridos; trata a volta do loop). */
export function eventsBetween(clip: ClipData, from: number, to: number): { frame: number; event: string }[] {
  if (!clip.events.length || to <= from) return [];
  const out: { frame: number; event: string }[] = [];
  if (!clip.loop) {
    for (const e of clip.events) if (e.frame > from && e.frame <= to) out.push(e);
    return out;
  }
  const len = clip.frames;
  for (let base = Math.floor(from / len) * len; base <= to; base += len)
    for (const e of clip.events) {
      const at = base + e.frame;
      if (at > from && at <= to) out.push(e);
    }
  return out;
}

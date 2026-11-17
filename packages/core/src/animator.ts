import {
  checkClip,
  clipFrame,
  eventsBetween,
  restBone,
  restRoot,
  sampleBone,
  sampleRoot,
  sampleSlot,
  type BoneSample,
  type ClipData,
  type RootSample,
} from './clip.js';
import { AUTHOR_FPS } from './loop.js';
import type { PoseData } from './pose.js';
import { DataError } from './validate.js';
import type { SolvedRig } from './rig.js';
import type { BonePose } from './skeleton.js';

/** Crossfade padrão entre clipes (frames de 60 fps). */
export const DEFAULT_FADE = 6;

interface Playing {
  clip: ClipData;
  /** Tempo corrido no clipe, em frames de 60 fps. */
  t: number;
  speed: number;
}

export interface LayerState {
  name: string;
  /** Ossos afetados (null = todos). */
  mask: Set<number> | null;
  weight: number;
  current: Playing | null;
  previous: Playing | null;
  fade: number;
  fadeLength: number;
}

export interface PlayOptions {
  layer?: string;
  /** Crossfade em frames (0 = corte seco). */
  fade?: number;
  speed?: number;
  /** Recomeça mesmo se o clipe já estiver tocando. */
  restart?: boolean;
}

export interface ClipEvent {
  clip: string;
  event: string;
  frame: number;
  layer: string;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Toca clipes num esqueleto: camadas (a "base" mexe em tudo; outras, só nos ossos da máscara,
 * por cima), crossfade entre clipes e eventos por frame. Determinístico: só depende dos `dt`.
 */
export class Animator {
  readonly layers: LayerState[] = [];
  onEvent?: (e: ClipEvent) => void;
  /** Poses nomeadas deste personagem, usadas como base pelos clipes ("pose": "fly_rest"). */
  readonly poses = new Map<string, PoseData>();

  constructor(readonly rig: SolvedRig) {
    this.addLayer('base');
  }

  /** Camada por cima das anteriores. `bones` = máscara (e os descendentes, se `withChildren`). */
  addLayer(name: string, bones?: string[], options: { withChildren?: boolean; weight?: number } = {}): LayerState {
    let mask: Set<number> | null = null;
    if (bones) {
      mask = new Set();
      const add = (i: number) => {
        mask!.add(i);
        if (options.withChildren !== false) for (const c of [...this.rig.bones[i]!.back, ...this.rig.bones[i]!.front]) add(c);
      };
      for (const b of bones) {
        const i = this.rig.byName.get(b);
        if (i === undefined) throw new Error(`camada ${name}: osso "${b}" não existe`);
        add(i);
      }
    }
    const layer: LayerState = { name, mask, weight: options.weight ?? 1, current: null, previous: null, fade: 0, fadeLength: 0 };
    this.layers.push(layer);
    return layer;
  }

  layer(name: string): LayerState {
    const l = this.layers.find((x) => x.name === name);
    if (!l) throw new Error(`camada "${name}" não existe`);
    return l;
  }

  play(clip: ClipData, options: PlayOptions = {}): void {
    checkClip(clip, this.rig);
    // Na pose-imagem a própria imagem é a base: a pose nomeada só vale no rig de peças.
    if (clip.pose && this.rig.kind !== 'image' && !this.poses.has(clip.pose))
      throw new DataError(`clip ${clip.id} (${this.rig.char})`, 'pose', `pose "${clip.pose}" não carregada para ${this.rig.char}`);
    const layer = this.layer(options.layer ?? 'base');
    if (layer.current?.clip === clip && !options.restart) return;
    const fade = options.fade ?? DEFAULT_FADE;
    layer.previous = fade > 0 && layer.current ? layer.current : null;
    layer.current = { clip, t: 0, speed: options.speed ?? 1 };
    layer.fade = 0;
    layer.fadeLength = layer.previous ? fade : 0;
  }

  /** Para a camada (com fade de volta ao repouso / às camadas de baixo). */
  stop(layerName: string, fade = DEFAULT_FADE): void {
    const layer = this.layer(layerName);
    layer.previous = fade > 0 ? layer.current : null;
    layer.current = null;
    layer.fade = 0;
    layer.fadeLength = layer.previous ? fade : 0;
  }

  current(layerName = 'base'): ClipData | null {
    return this.layer(layerName).current?.clip ?? null;
  }

  /** O clipe (sem loop) da camada chegou ao fim. */
  finished(layerName = 'base'): boolean {
    const c = this.layer(layerName).current;
    return !!c && !c.clip.loop && c.t >= c.clip.frames;
  }

  /** Frame local do clipe atual da camada. */
  frame(layerName = 'base'): number {
    const c = this.layer(layerName).current;
    return c ? clipFrame(c.clip, c.t) : 0;
  }

  advance(dt: number): void {
    const df = dt * AUTHOR_FPS;
    for (const layer of this.layers) {
      if (layer.previous) {
        layer.previous.t += df * layer.previous.speed;
        layer.fade += df;
        if (layer.fade >= layer.fadeLength) layer.previous = null;
      }
      const c = layer.current;
      if (!c) continue;
      const from = c.t;
      c.t += df * c.speed;
      if (this.onEvent)
        for (const e of eventsBetween(c.clip, from, c.t)) this.onEvent({ clip: c.clip.id, event: e.event, frame: e.frame, layer: layer.name });
    }
  }

  /**
   * Escreve a pose nos ossos (zera para o repouso antes) e devolve o deslocamento visual da raiz.
   */
  apply(pose: BonePose[]): RootSample {
    const bones = this.rig.bones;
    bones.forEach((b, i) => {
      const p = pose[i]!;
      p.rotation = 0;
      p.offset = { x: 0, y: 0 };
      p.scale = 1;
      p.slot = b.hidden ? null : b.part;
    });
    const root = restRoot();
    const sampleOf = (play: Playing | null, bone: string): BoneSample => {
      if (!play) return restBone();
      const s = sampleBone(play.clip, bone, clipFrame(play.clip, play.t)) ?? restBone();
      const base = play.clip.pose && this.rig.kind !== 'image' ? this.poses.get(play.clip.pose)?.bones.get(bone) : undefined;
      return base ? { rot: s.rot + base.rot, x: s.x + base.x, y: s.y + base.y, scale: s.scale * base.scale } : s;
    };
    for (const layer of this.layers) {
      if (!layer.current && !layer.previous) continue;
      const w = layer.previous && layer.fadeLength > 0 ? smooth(Math.min(1, layer.fade / layer.fadeLength)) : 1;
      bones.forEach((b, i) => {
        if (layer.mask && !layer.mask.has(i)) return;
        const cur = sampleOf(layer.current, b.name);
        const prev = layer.previous ? sampleOf(layer.previous, b.name) : cur;
        const p = pose[i]!;
        const k = layer.weight;
        const mix = (a: number, c: number) => a + (c - a) * w;
        p.rotation += (mix(prev.rot, cur.rot) - p.rotation) * k;
        p.offset = { x: p.offset.x + (mix(prev.x, cur.x) - p.offset.x) * k, y: p.offset.y + (mix(prev.y, cur.y) - p.offset.y) * k };
        p.scale += (mix(prev.scale, cur.scale) - p.scale) * k;
        // Slot: troca seca, do clipe que domina o fade.
        const from = w >= 0.5 ? layer.current : layer.previous;
        if (from) {
          const baseSlot = from.clip.pose && this.rig.kind !== 'image' ? this.poses.get(from.clip.pose)?.bones.get(b.name)?.slot : undefined;
          if (baseSlot !== undefined) p.slot = baseSlot;
          const slot = sampleSlot(from.clip, b.name, clipFrame(from.clip, from.t));
          if (slot !== undefined) p.slot = slot === 'default' ? (b.hidden ? null : b.part) : slot === 'none' ? null : slot;
        }
      });
      if (!layer.mask) {
        const cur = layer.current ? sampleRoot(layer.current.clip, clipFrame(layer.current.clip, layer.current.t)) : restRoot();
        const prev = layer.previous ? sampleRoot(layer.previous.clip, clipFrame(layer.previous.clip, layer.previous.t)) : cur;
        for (const key of ['x', 'y', 'rot', 'sx', 'sy'] as const) root[key] = prev[key] + (cur[key] - prev[key]) * w;
      }
    }
    return root;
  }
}

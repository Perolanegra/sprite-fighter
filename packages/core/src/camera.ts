import { ease, type EaseName } from './easing.js';
import type { Camera } from './renderer.js';

/** Caixa no mundo (x, y = canto de cima à esquerda). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AutoOptions {
  /** Ids a enquadrar (personagens ou props); padrão: todos os personagens visíveis. */
  targets?: string[] | null;
  /** Margem em px da tela em volta da caixa. */
  margin?: number;
  minZoom?: number;
  maxZoom?: number;
  /** Rapidez do ajuste (1/s). */
  rate?: number;
}

type Mode = { type: 'auto' } | { type: 'follow'; id: string; offset: { x: number; y: number } } | { type: 'fixed' };

interface Tween {
  from: number;
  to: number;
  t: number;
  dur: number;
  ease: EaseName;
}

/** Ruído suave 1D, determinístico (valor com interpolação suave entre inteiros). */
export function smoothNoise(t: number, seed: number): number {
  const h = (i: number) => {
    let x = (i * 374761393 + seed * 668265263) | 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967295 * 2 - 1;
  };
  const i = Math.floor(t), f = t - i;
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

/** Tremida máxima (trauma 1): deslocamento em px da tela e giro (rad). */
export const SHAKE_MAX = { offset: 34, rotation: 0.035 };
/** Quanto o trauma cai por segundo. */
export const TRAUMA_DECAY = 1.4;

/**
 * Câmera dirigível, em passo fixo (determinística no seek):
 *  - `auto` (padrão): enquadra os alvos (zoom pra caber, com margem). Nunca corta um alvo:
 *    a suavização é limitada por uma restrição dura no fim de cada passo;
 *  - `follow(id)`: centra num personagem; `pan(x, y, s)`: vai até um ponto e fica (fixed);
 *  - `zoom(z, s)`: no auto vira o zoom máximo; nos outros modos, o zoom;
 *  - `shake(trauma)`: tremida por trauma (decai com o tempo, intensidade = trauma², ruído suave).
 *    Anda em tempo real: continua tremendo no hitstop e não fica lenta na câmera lenta.
 */
export class CameraRig {
  x = 0;
  y = 0;
  zoom = 1;
  /** Tamanho da vista (px CSS). */
  width = 1280;
  height = 720;
  trauma = 0;
  mode: Mode = { type: 'auto' };
  auto: Required<Omit<AutoOptions, 'targets'>> & { targets: string[] | null } = { targets: null, margin: 90, minZoom: 0.2, maxZoom: 1, rate: 5 };
  /** Zoom pedido pelo roteiro (no auto, é o teto). */
  private zoomWanted: number | null = null;
  private zoomTween: Tween | null = null;
  private panTween: { x: Tween; y: Tween } | null = null;
  private time = 0;
  private prev: Required<Camera> | null = null;
  private curr: Required<Camera> | null = null;
  private started = false;

  constructor(readonly seed = 1) {}

  /** Centra já (sem suavizar) no próximo passo. */
  snap(): void {
    this.started = false;
  }

  /**
   * Põe a câmera direto no enquadramento-alvo, sem suavizar e sem andar o tempo (tremida e tweens
   * ficam como estão), e zera a interpolação: a vista já sai enquadrada no quadro atual. É o
   * primeiro quadro de toda cena (início, seek, recomeço); a suavização só vale entre passos.
   */
  frame(boxes: Map<string, Rect>, visible: string[]): void {
    this.started = false;
    this.step(0, boxes, visible);
    this.prev = this.curr;
  }

  setAuto(options: AutoOptions = {}): void {
    this.mode = { type: 'auto' };
    this.panTween = null;
    Object.assign(this.auto, Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)));
  }

  follow(id: string, offset = { x: 0, y: 0 }): void {
    this.mode = { type: 'follow', id, offset };
    this.panTween = null;
  }

  pan(x: number, y: number, seconds = 0.6, easing: EaseName = 'sineInOut'): void {
    this.mode = { type: 'fixed' };
    this.panTween = { x: { from: this.x, to: x, t: 0, dur: seconds, ease: easing }, y: { from: this.y, to: y, t: 0, dur: seconds, ease: easing } };
  }

  zoomTo(z: number | null, seconds = 0.4, easing: EaseName = 'sineInOut'): void {
    if (z === null) {
      this.zoomWanted = null;
      this.zoomTween = null;
      return;
    }
    this.zoomTween = { from: this.zoomWanted ?? this.zoom, to: z, t: 0, dur: seconds, ease: easing };
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Um passo (tempo real). `boxes`: caixas dos alvos possíveis por id; `visible`: os ids padrão do auto. */
  step(dt: number, boxes: Map<string, Rect>, visible: string[]): void {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
    const tick = (tw: Tween) => {
      tw.t = Math.min(tw.dur, tw.t + dt);
      return tw.from + (tw.to - tw.from) * ease(tw.ease, tw.dur > 0 ? tw.t / tw.dur : 1);
    };
    if (this.zoomTween) {
      this.zoomWanted = tick(this.zoomTween);
      if (this.zoomTween.t >= this.zoomTween.dur) this.zoomTween = null;
    }
    const k = this.started ? 1 - Math.exp(-this.auto.rate * dt) : 1;
    const m = this.mode;
    const ids = this.auto.targets ?? visible;
    const box = union(ids.map((id) => boxes.get(id)).filter((b): b is Rect => !!b && b.w + b.h > 0));
    if (m.type === 'auto' && box) {
      const mg = this.auto.margin;
      const fit = Math.min((this.width - 2 * mg) / Math.max(1, box.w), (this.height - 2 * mg) / Math.max(1, box.h));
      const want = Math.max(this.auto.minZoom, Math.min(this.auto.maxZoom, this.zoomWanted ?? Infinity, fit));
      this.zoom += (want - this.zoom) * k;
      this.x += (box.x + box.w / 2 - this.x) * k;
      this.y += (box.y + box.h / 2 - this.y) * k;
    } else if (m.type === 'follow') {
      const b = boxes.get(m.id);
      if (b) {
        this.x += (b.x + b.w / 2 + m.offset.x - this.x) * k;
        this.y += (b.y + b.h / 2 + m.offset.y - this.y) * k;
      }
      if (this.zoomWanted !== null) this.zoom = this.zoomWanted;
    } else {
      if (this.panTween) {
        this.x = tick(this.panTween.x);
        this.y = tick(this.panTween.y);
        if (this.panTween.x.t >= this.panTween.x.dur) this.panTween = null;
      }
      if (this.zoomWanted !== null) this.zoom = this.zoomWanted;
    }
    if (m.type === 'auto' && box) this.contain(box);
    this.started = true;
    this.prev = this.curr;
    this.curr = this.shaken();
    this.prev ??= this.curr;
  }

  /** Restrição dura do auto: a caixa cabe inteira, com folga para a tremida. */
  private contain(box: Rect): void {
    const mg = 24 + SHAKE_MAX.offset;
    const fit = Math.min((this.width - 2 * mg) / Math.max(1, box.w), (this.height - 2 * mg) / Math.max(1, box.h));
    if (this.zoom > fit) this.zoom = fit;
    const hw = this.width / 2 / this.zoom - mg / this.zoom, hh = this.height / 2 / this.zoom - mg / this.zoom;
    this.x = Math.min(box.x + hw, Math.max(box.x + box.w - hw, this.x));
    this.y = Math.min(box.y + hh, Math.max(box.y + box.h - hh, this.y));
  }

  private shaken(): Required<Camera> {
    const s = this.trauma * this.trauma;
    const f = 18; // Hz do ruído
    const t = this.time * f;
    return {
      x: this.x + (SHAKE_MAX.offset * s * smoothNoise(t, this.seed)) / this.zoom,
      y: this.y + (SHAKE_MAX.offset * s * smoothNoise(t, this.seed + 1)) / this.zoom,
      zoom: this.zoom,
      rotation: SHAKE_MAX.rotation * s * smoothNoise(t, this.seed + 2),
    };
  }

  /** Vista para o render, interpolada entre os dois últimos passos. */
  view(alpha = 1): Required<Camera> {
    const a = this.prev, b = this.curr;
    if (!a || !b) return { x: this.x, y: this.y, zoom: this.zoom, rotation: 0 };
    const l = (p: number, q: number) => p + (q - p) * alpha;
    return { x: l(a.x, b.x), y: l(a.y, b.y), zoom: l(a.zoom, b.zoom), rotation: l(a.rotation, b.rotation) };
  }
}

export function union(boxes: Rect[]): Rect | null {
  if (!boxes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

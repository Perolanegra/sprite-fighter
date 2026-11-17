import { Director, type CastMember } from './director.js';
import type { ClipData } from './clip.js';
import { drawProjectiles } from './fight-draw.js';
import type { World } from './world.js';
import { drawParallax, type ParallaxLayer } from './parallax.js';
import { drawProps } from './props.js';
import { CanvasRenderer } from './renderer.js';

export interface SceneOptions {
  characters: Record<string, CastMember> | Map<string, CastMember>;
  clips?: Map<string, ClipData>;
  /** Tamanho em px CSS (padrão: o tamanho do canvas na página). */
  width?: number;
  height?: number;
  /** Cenário em paralaxe (atrás de tudo). */
  parallax?: ParallaxLayer[];
  /** Desenho de fundo (antes da paralaxe), ex.: um céu em gradiente. */
  drawBackground?: (r: CanvasRenderer) => void;
  /** Desenho por cima de tudo (HUD). */
  drawOverlay?: (r: CanvasRenderer, scene: Scene) => void;
  /** false = Canvas 2D (sem WebGL). */
  webGL?: boolean;
  /** WebGL em camada própria no DOM (ao vivo é o mais rápido). Padrão: true. */
  layers?: boolean;
  /**
   * Desenho de debug por cima da cena (ossos, hurtboxes, hitboxes, pose atual): passe o
   * `drawFightDebug` de `sprite-fighter/authoring`. Fora do player, para não pesar no bundle.
   */
  debug?: DebugDraw | null;
  /** Distância do aviso `incoming` (ver World). */
  incomingDistance?: number;
}

/** Desenho de debug do mundo (ex.: `drawFightDebug` de `sprite-fighter/authoring`). */
export type DebugDraw = (r: CanvasRenderer, world: World) => void;

type Listener = (payload: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Cena no navegador: o diretor (roteiro sobre a simulação) mais o desenho (paralaxe, props,
 * personagens, projéteis, efeitos, balões) e o laço de quadros.
 *
 *   const scene = await Scene.create(canvas, { characters: { '<id>': { character, moves } }, clips });
 *   await scene.load('scenes/<nome>.json');   // ou o objeto do roteiro / script(...).toJSON()
 *   scene.on('hit', (e) => …);
 *   scene.play();
 */
export class Scene {
  readonly renderer: CanvasRenderer;
  director: Director | null = null;
  /** Desenho de debug (null = desligado); pode mudar ao vivo. */
  debug: DebugDraw | null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private unhook: (() => void)[] = [];
  private raf = 0;
  private last = 0;
  private alpha = 1;
  private loopFlag = false;
  private speed = 1;
  private destroyed = false;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    readonly options: SceneOptions,
  ) {
    this.renderer = new CanvasRenderer(canvas);
    this.renderer.useWebGL = options.webGL !== false;
    this.debug = options.debug ?? null;
  }

  static async create(canvas: HTMLCanvasElement, options: SceneOptions): Promise<Scene> {
    const s = new Scene(canvas, options);
    const r = s.renderer;
    r.resize(options.width ?? (canvas.clientWidth || 1280), options.height ?? (canvas.clientHeight || 720));
    if (options.layers !== false) r.useLayers();
    return s;
  }

  /**
   * Fim de uso: para o laço de quadros, solta os ouvintes e o diretor, libera o contexto WebGL
   * (texturas, buffers) e tira as camadas do DOM. A cena não pode mais ser usada.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopLoop();
    for (const off of this.unhook) off();
    this.unhook = [];
    this.listeners.clear();
    this.director?.dispose();
    this.director = null;
    this.renderer.dispose();
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Carrega um roteiro (URL do JSON, o JSON já lido ou um `Script`). Volta ao instante 0, pausado.
   * `name` aparece nas mensagens de erro (ex.: a URL de onde o JSON veio).
   */
  async load(script: string | unknown, name?: string): Promise<void> {
    let json = script;
    let source = name ? `roteiro ${name}` : 'roteiro';
    if (typeof script === 'string') {
      const res = await fetch(script);
      if (!res.ok) throw new Error(`roteiro não encontrado: ${script} (${res.status})`);
      json = await res.json();
      source = `roteiro ${script}`;
    }
    const d = await Director.create(json, {
      characters: this.options.characters,
      clips: this.options.clips,
      viewport: { width: this.renderer.width, height: this.renderer.height },
      ...(this.options.incomingDistance !== undefined ? { incomingDistance: this.options.incomingDistance } : {}),
    }, source);
    if (this.destroyed) return d.dispose(); // destruída durante a carga
    const members = this.options.characters instanceof Map ? [...this.options.characters.values()] : Object.values(this.options.characters);
    for (const m of members) this.renderer.preload(m.character);
    d.loop = this.loopFlag;
    d.timeScale = this.speed;
    for (const off of this.unhook) off();
    this.director = d;
    this.unhook = [...this.listeners.keys()].map((name) => d.on(name, (p) => this.emit(name, p)));
    this.alpha = 1;
    this.render();
  }

  on(event: string, fn: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      this.listeners.set(event, (set = new Set()));
      if (this.director) this.unhook.push(this.director.on(event, (p) => this.emit(event, p)));
    }
    set.add(fn);
    return () => set.delete(fn);
  }
  private emit(event: string, payload: unknown): void {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }

  private get d(): Director {
    if (!this.director) throw new Error('Scene: carregue um roteiro antes (scene.load)');
    return this.director;
  }

  get time(): number {
    return this.director?.time ?? 0;
  }
  get duration(): number {
    return this.director?.duration ?? 0;
  }
  get progress(): number {
    return this.director?.progress ?? 0;
  }
  get playing(): boolean {
    return this.director?.playing ?? false;
  }
  get loop(): boolean {
    return this.loopFlag;
  }
  set loop(v: boolean) {
    this.loopFlag = v;
    if (this.director) this.director.loop = v;
  }
  get timeScale(): number {
    return this.speed;
  }
  set timeScale(v: number) {
    this.speed = v;
    if (this.director) this.director.timeScale = v;
  }

  play(): void {
    if (this.destroyed) return;
    this.d.play();
    if (this.raf) return;
    this.last = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const dt = (now - this.last) / 1000;
      this.last = now;
      this.alpha = this.d.advance(dt);
      // Um ouvinte (end, hit…) pode ter destruído a cena no meio do avanço.
      if (this.destroyed) return;
      this.render(this.alpha);
      if (!this.d.playing) this.stopLoop();
    };
    this.raf = requestAnimationFrame(frame);
  }
  pause(): void {
    if (this.destroyed) return;
    this.director?.pause();
    this.stopLoop();
    this.render(this.alpha);
  }
  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
  /** Vai para o instante `t` (s), re-simulando do início (determinístico), e desenha. */
  seek(t: number): void {
    if (this.destroyed) return;
    this.d.seek(t);
    this.alpha = 1;
    this.render();
  }

  /** Novo tamanho (px CSS) e DPR (padrão: o da janela); todas as camadas juntas. */
  resize(width: number, height: number, dpr?: number): void {
    if (this.destroyed) return;
    this.renderer.resize(width, height, dpr);
    if (this.director) this.director.viewport = { width, height };
    this.render(this.alpha);
  }

  /** Desenha o quadro atual (`alpha` = interpolação entre os dois últimos passos). */
  render(alpha = 1): void {
    const d = this.director;
    const r = this.renderer;
    if (!d || this.destroyed) return;
    const w = d.world;
    r.camera = w.camera.view(alpha);
    r.clear();
    this.options.drawBackground?.(r);
    if (this.options.parallax) drawParallax(r, this.options.parallax, w.realTime);
    w.fx.drawBack(r);
    drawProps(r, w.props.values(), d.time);
    r.batch(() => {
      for (const f of d.fighters) {
        r.hide = d.hidden.get(f.id) ?? null;
        f.actor.draw(r, alpha);
      }
      r.hide = null;
    });
    drawProjectiles(r, w);
    w.fx.drawFront(r);
    this.drawBubbles();
    this.debug?.(r, w);
    this.options.drawOverlay?.(r, this);
  }

  private drawBubbles(): void {
    const d = this.director!;
    const r = this.renderer;
    const { ctx } = r;
    const v = r.viewMatrix();
    for (const b of d.bubbles) {
      const box = d.world.fighter(b.actor).actor.bounds();
      const x = (box.x + box.w / 2) * v[0] + v[4], y = box.y * v[3] + v[5] - 14 * r.dpr;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = `600 ${16 * r.dpr}px system-ui, sans-serif`;
      const tw = ctx.measureText(b.text).width, pad = 10 * r.dpr, h = 30 * r.dpr;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#151515';
      ctx.lineWidth = 2 * r.dpr;
      ctx.beginPath();
      ctx.roundRect(x - tw / 2 - pad, y - h, tw + pad * 2, h, 10 * r.dpr);
      ctx.moveTo(x - 6 * r.dpr, y);
      ctx.lineTo(x, y + 10 * r.dpr);
      ctx.lineTo(x + 6 * r.dpr, y);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#151515';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.text, x, y - h / 2);
      ctx.restore();
    }
  }
}

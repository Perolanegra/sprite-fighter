import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  PLATFORM_ID,
  afterNextRender,
  booleanAttribute,
  effect,
  inject,
  input,
  numberAttribute,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Scene, type CanvasRenderer, type ClipData, type DebugDraw, type HitEvent, type ParallaxLayer, type StepEvent } from '@perolanegra/sprite-fighter';
import { SfAssets, type SfCharacters } from './sf-assets';

export interface SfReadyEvent {
  scene: Scene;
  duration: number;
  title: string;
}

/** Fração da cena visível para contar como "na tela" (`playOnVisible`). */
const VISIBLE_RATIO = 0.5;

/**
 * Cena roteirizada do sprite-fighter.
 *
 *   <sf-scene [characters]="cast" script="scenes/<nome>.json" clips="clips/index.json" autoplay (end)="…" />
 *
 * Camadas: o canvas do cenário (fundo, paralaxe, props) e, por cima, a camada WebGL dos personagens e
 * a camada 2D da frente (efeitos, balões, HUD), que o renderer cria ao lado do canvas. As três ficam
 * empilhadas no host e mudam de tamanho juntas (tamanho do host × DPR).
 *
 * O laço de quadros roda fora da zona do Angular; só os eventos (ready, step, hit, end) voltam à zona.
 * As poses e variantes citadas pelo roteiro (e pelos golpes) carregam e sobem para a GPU antes do `(ready)`.
 * Ao destruir, para o laço e libera o contexto WebGL, as texturas, as camadas, os observers e os ouvintes.
 */
let debugDraw: Promise<DebugDraw> | null = null;
/** `drawFightDebug` de `sprite-fighter/authoring`, por import dinâmico (fora do bundle principal). */
const loadDebugDraw = () => (debugDraw ??= import('@perolanegra/sprite-fighter/authoring').then((m) => m.drawFightDebug));

@Component({
  selector: 'sf-scene',
  template: '<canvas #canvas></canvas>',
  styles: `
    :host { display: block; position: relative; overflow: hidden; aspect-ratio: 16 / 9; }
    canvas { position: absolute; left: 0; top: 0; display: block; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': 'title() || null', '[attr.aria-busy]': '!loaded()' },
})
export class SfSceneComponent {
  /** Elenco por id (os ids do `cast` do roteiro): definição por URL ou personagem já carregado. */
  readonly characters = input.required<SfCharacters>();
  /** URL do roteiro JSON, o JSON já lido ou `script(...).toJSON()`. */
  readonly script = input.required<string | object>();
  /** Biblioteca de clipes: URL do `index.json` ou o mapa já carregado. */
  readonly clips = input<string | Map<string, ClipData> | null>(null);
  readonly autoplay = input(false, { transform: booleanAttribute });
  readonly loop = input(false, { transform: booleanAttribute });
  readonly debug = input(false, { transform: booleanAttribute });
  readonly timeScale = input(1, { transform: numberAttribute });
  /** false força o fallback Canvas 2D (sem contexto WebGL). */
  readonly webgl = input(true, { transform: booleanAttribute });
  /**
   * Toca quando pelo menos metade da cena entra na tela e pausa quando sai (IntersectionObserver).
   * Se a cena já tinha terminado, recomeça do início. Um `pause()` explícito desliga a retomada.
   */
  readonly playOnVisible = input(false, { transform: booleanAttribute });
  /** Cenário em paralaxe, desenho de fundo e desenho por cima de tudo (HUD). */
  readonly parallax = input<ParallaxLayer[] | null>(null);
  readonly background = input<((r: CanvasRenderer) => void) | null>(null);
  readonly overlay = input<((r: CanvasRenderer, scene: Scene) => void) | null>(null);

  readonly ready = output<SfReadyEvent>();
  readonly step = output<StepEvent>();
  readonly hit = output<HitEvent>();
  readonly end = output<{ time: number }>();
  /** A carga falhou (asset que falta, roteiro inválido…). */
  readonly loadError = output<Error>();

  /** Título do roteiro (aria-label). */
  readonly title = signal('');
  readonly loaded = signal(false);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private readonly assets = inject(SfAssets);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly mounted = signal(false);
  private readonly scene$ = signal<Scene | null>(null);
  /** Geração da carga: uma carga antiga (inputs trocados, componente destruído) é descartada. */
  private gen = 0;
  private destroyed = false;
  private visible = false;
  private userPaused = false;
  private cleanup: (() => void)[] = [];

  constructor() {
    afterNextRender(() => {
      this.mounted.set(true);
      this.zone.runOutsideAngular(() => this.observe());
    });

    // Elenco, roteiro, clipes, WebGL ou cenário trocados: monta a cena de novo.
    effect(() => {
      if (!this.browser || !this.mounted()) return;
      const config = {
        characters: this.characters(),
        script: this.script(),
        clips: this.clips(),
        webgl: this.webgl(),
        parallax: this.parallax(),
        background: this.background(),
        overlay: this.overlay(),
      };
      untracked(() => void this.build(config));
    });

    // Ajustes ao vivo, sem remontar.
    effect(() => {
      const scene = this.scene$();
      const loop = this.loop(), timeScale = this.timeScale(), debug = this.debug();
      if (!scene) return;
      scene.loop = loop;
      scene.timeScale = timeScale;
      if (!debug) {
        if (scene.debug) {
          scene.debug = null;
          if (!scene.playing) scene.render();
        }
        return;
      }
      // O desenho de debug fica em sprite-fighter/authoring: só é baixado quando ligado.
      void loadDebugDraw().then((draw) => {
        if (scene.isDestroyed || !this.debug() || scene.debug === draw) return;
        scene.debug = draw;
        if (!scene.playing) scene.render();
      });
    });

    inject(DestroyRef).onDestroy(() => this.destroy());
  }

  /** A cena por baixo (null antes do `(ready)`). */
  get scene(): Scene | null {
    return this.scene$();
  }
  get time(): number {
    return this.scene$()?.time ?? 0;
  }
  get duration(): number {
    return this.scene$()?.duration ?? 0;
  }
  get playing(): boolean {
    return this.scene$()?.playing ?? false;
  }

  play(): void {
    const scene = this.scene$();
    if (!scene) return;
    this.userPaused = false;
    if (scene.duration && scene.time >= scene.duration && !scene.loop) scene.seek(0);
    // O requestAnimationFrame é agendado fora da zona: os quadros não disparam detecção de mudanças.
    this.zone.runOutsideAngular(() => scene.play());
  }

  pause(): void {
    this.userPaused = true;
    this.scene$()?.pause();
  }

  /** Vai para o instante `t` (s), re-simulando do início (determinístico). */
  seek(t: number): void {
    this.scene$()?.seek(t);
  }

  private async build(config: {
    characters: SfCharacters;
    script: string | object;
    clips: string | Map<string, ClipData> | null;
    webgl: boolean;
    parallax: ParallaxLayer[] | null;
    background: ((r: CanvasRenderer) => void) | null;
    overlay: ((r: CanvasRenderer, scene: Scene) => void) | null;
  }): Promise<void> {
    const gen = ++this.gen;
    this.dropScene();
    try {
      const [characters, clips, json] = await Promise.all([
        this.assets.cast(config.characters),
        typeof config.clips === 'string' ? this.assets.clips(config.clips) : (config.clips ?? undefined),
        typeof config.script === 'string' ? this.assets.script(config.script) : config.script,
      ]);
      if (gen !== this.gen) return;
      const { width, height } = this.size();
      const scene = await Scene.create(this.canvas().nativeElement, {
        characters,
        ...(clips ? { clips } : {}),
        width,
        height,
        webGL: config.webgl,
        ...(config.parallax ? { parallax: config.parallax } : {}),
        ...(config.background ? { drawBackground: config.background } : {}),
        ...(config.overlay ? { drawOverlay: config.overlay } : {}),
      });
      // Os eventos do laço (fora da zona) voltam à zona só quando emitidos.
      scene.on('step', (e: StepEvent) => this.zone.run(() => this.step.emit(e)));
      scene.on('hit', (e: HitEvent) => this.zone.run(() => this.hit.emit(e)));
      scene.on('end', (e: { time: number }) => this.zone.run(() => this.end.emit(e)));
      try {
        // Carrega as poses/variantes citadas, mede a duração e sobe as texturas para a GPU.
        await scene.load(json, typeof config.script === 'string' ? config.script : undefined);
      } catch (err) {
        scene.destroy();
        throw err;
      }
      if (gen !== this.gen) return scene.destroy();
      this.scene$.set(scene);
      scene.loop = this.loop();
      scene.timeScale = this.timeScale();
      const title = scene.director!.script.title;
      this.title.set(title);
      this.loaded.set(true);
      this.ready.emit({ scene, duration: scene.duration, title });
      if (this.playOnVisible() ? this.visible : this.autoplay()) this.play();
    } catch (err) {
      if (gen !== this.gen) return;
      this.loadError.emit(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Tamanho do host em px CSS (antes do layout, 1280 × 720). */
  private size(): { width: number; height: number } {
    const r = this.host.getBoundingClientRect();
    return { width: Math.round(r.width) || 1280, height: Math.round(r.height) || 720 };
  }

  /** ResizeObserver, DPR (matchMedia) e IntersectionObserver; registrados fora da zona. */
  private observe(): void {
    const resize = () => {
      const scene = this.scene$();
      if (!scene) return;
      const { width, height } = this.size();
      const dpr = globalThis.devicePixelRatio || 1;
      if (width !== scene.renderer.width || height !== scene.renderer.height || dpr !== scene.renderer.dpr) scene.resize(width, height, dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(this.host);
    this.cleanup.push(() => ro.disconnect());

    // O DPR muda ao arrastar a janela para outro monitor ou com zoom: a consulta vale para o DPR
    // atual e é refeita a cada mudança.
    let mql: MediaQueryList | null = null;
    const onDpr = () => {
      mql?.removeEventListener('change', onDpr);
      mql = matchMedia(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`);
      mql.addEventListener('change', onDpr);
      resize();
    };
    onDpr();
    this.cleanup.push(() => mql?.removeEventListener('change', onDpr));

    const io = new IntersectionObserver(
      ([entry]) => {
        this.visible = !!entry && entry.intersectionRatio >= VISIBLE_RATIO;
        const scene = this.scene$();
        if (!scene || !this.playOnVisible()) return;
        if (this.visible && !scene.playing && !this.userPaused) this.play();
        else if (!this.visible && scene.playing) scene.pause();
      },
      { threshold: [0, VISIBLE_RATIO] },
    );
    io.observe(this.host);
    this.cleanup.push(() => io.disconnect());
  }

  private dropScene(): void {
    this.scene$()?.destroy();
    this.scene$.set(null);
    this.loaded.set(false);
  }

  private destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gen++; // descarta a carga em andamento
    this.dropScene();
    for (const off of this.cleanup) off();
    this.cleanup = [];
  }
}

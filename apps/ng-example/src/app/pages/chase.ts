import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, inject, signal, viewChild } from '@angular/core';
import { SfSceneComponent, type SfReadyEvent } from '@perolanegra/ngx-sprite-fighter';
import type { HitEvent, StepEvent } from '@perolanegra/sprite-fighter';
import { cityLayers, drawSky } from '../backdrop';
import { CAST } from '../cast';

@Component({
  selector: 'app-chase',
  imports: [SfSceneComponent],
  template: `
    <h1>Perseguição</h1>
    <sf-scene
      #scene
      [characters]="cast"
      script="scenes/chase.json"
      clips="clips/index.json"
      [parallax]="parallax"
      [background]="sky"
      [autoplay]="true"
      [loop]="loop()"
      [timeScale]="slow() ? 0.25 : 1"
      [debug]="debug()"
      (ready)="onReady($event)"
      (step)="onStep($event)"
      (hit)="onHit($event)"
      (end)="ended.set(true)"
      (loadError)="error.set($event.message)"
    />
    <div class="controls">
      <button type="button" (click)="toggle()">{{ playing() ? 'Pausar' : 'Tocar' }}</button>
      <button type="button" (click)="restart()">Recomeçar</button>
      <button type="button" (click)="slow.set(!slow())">Câmera lenta: {{ slow() ? 'sim' : 'não' }}</button>
      <button type="button" (click)="loop.set(!loop())">Laço: {{ loop() ? 'sim' : 'não' }}</button>
      <button type="button" (click)="debug.set(!debug())">Debug: {{ debug() ? 'sim' : 'não' }}</button>
      <input #bar type="range" min="0" [max]="duration()" step="0.0166" (input)="seekTo(bar.valueAsNumber)" aria-label="Tempo da cena" />
    </div>
    @if (error()) {
      <p class="error">Erro: {{ error() }}</p>
    }
    <p class="log">
      {{ duration() ? duration().toFixed(2) + ' s' : 'carregando…' }} · passos iniciados: {{ steps() }} · contatos: {{ hits().length }}
      @if (hits().length) {
        (último: {{ hits()[hits().length - 1] }})
      }
      @if (ended()) {
        · fim
      }
    </p>
  `,
  styles: `
    sf-scene { border-radius: 8px; background: #14151c; }
    .controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0; }
    .controls input { flex: 1; min-width: 160px; }
    .log { color: var(--muted); }
    .error { color: #ff7a7a; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChasePage {
  readonly cast = CAST;
  readonly parallax = cityLayers(620);
  readonly sky = drawSky;
  readonly loop = signal(false);
  readonly slow = signal(false);
  readonly debug = signal(false);
  readonly playing = signal(false);
  readonly duration = signal(0);
  readonly steps = signal(0);
  readonly hits = signal<string[]>([]);
  readonly ended = signal(false);
  readonly error = signal('');
  private readonly scene = viewChild.required<SfSceneComponent>('scene');
  private readonly bar = viewChild.required<ElementRef<HTMLInputElement>>('bar');

  constructor() {
    // A barra de tempo acompanha a cena sem detecção de mudanças: escreve direto no DOM, num
    // requestAnimationFrame fora da zona (que para junto com a página).
    const zone = inject(NgZone);
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const bar = this.bar().nativeElement;
      if (document.activeElement !== bar) bar.valueAsNumber = this.scene().time;
      if (this.playing() !== this.scene().playing) zone.run(() => this.playing.set(this.scene().playing));
    };
    zone.runOutsideAngular(() => (raf = requestAnimationFrame(tick)));
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(raf));
  }

  onReady(e: SfReadyEvent): void {
    this.duration.set(e.duration);
  }
  onStep(e: StepEvent): void {
    if (e.phase === 'start') this.steps.update((n) => n + 1);
  }
  onHit(e: HitEvent): void {
    this.hits.update((h) => [...h, `${e.attacker} → ${e.target}`]);
  }
  toggle(): void {
    if (this.scene().playing) this.scene().pause();
    else this.scene().play();
  }
  restart(): void {
    this.steps.set(0);
    this.hits.set([]);
    this.ended.set(false);
    this.scene().seek(0);
    this.scene().play();
  }
  seekTo(t: number): void {
    this.scene().pause();
    this.scene().seek(t);
  }
}

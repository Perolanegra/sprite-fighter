import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { SfSceneComponent } from '@perolanegra/ngx-sprite-fighter';
import { drawSky } from '../backdrop';
import { CAST } from '../cast';

/** O chute giratório só toca quando pelo menos metade da cena entra na tela (e pausa ao sair). */
@Component({
  selector: 'app-kick',
  imports: [SfSceneComponent],
  template: `
    <h1>Chute giratório</h1>
    <p>Role a página para baixo: a cena começa quando aparece na tela e pausa quando sai.</p>
    <div class="spacer" aria-hidden="true">↓</div>
    <sf-scene
      [characters]="{ neo: cast['neo']! }"
      script="scenes/chute-giratorio.json"
      clips="clips/index.json"
      [background]="sky"
      [playOnVisible]="true"
      [loop]="true"
      (ready)="status.set('pronta, esperando entrar na tela')"
      (step)="status.set('tocando (' + $event.do + ' em ' + $event.time.toFixed(2) + ' s)')"
      (loadError)="status.set('erro: ' + $event.message)"
    />
    <p class="status">{{ status() }}</p>
    <div class="spacer" aria-hidden="true"></div>
  `,
  styles: `
    .spacer { height: 110vh; display: grid; place-items: center; color: var(--muted); font-size: 32px; }
    sf-scene { border-radius: 8px; max-width: 900px; margin: 0 auto; }
    .status { color: var(--muted); text-align: center; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KickPage {
  readonly cast = CAST;
  readonly sky = drawSky;
  readonly status = signal('carregando…');
}

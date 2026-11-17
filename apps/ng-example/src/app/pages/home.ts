import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Página sem cena: sair de uma rota de cena para cá não pode deixar nada rodando. */
@Component({
  selector: 'app-home',
  imports: [RouterLink],
  template: `
    <h1>Cenas roteirizadas no Angular</h1>
    <p>
      O componente <code>&lt;sf-scene&gt;</code> toca um roteiro JSON do sprite-fighter. Os personagens vêm só das
      poses-imagem (<code>skins/&lt;id&gt;.json</code>) e dos golpes.
    </p>
    <ul>
      <li><a routerLink="/perseguicao">Perseguição</a>: o agente persegue, atira duas vezes e bate na porta.</li>
      <li><a routerLink="/chute">Chute giratório</a>: a cena só toca quando entra na tela.</li>
    </ul>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {}

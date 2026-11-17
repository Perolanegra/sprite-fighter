import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <nav>
      <strong>ngx-sprite-fighter</strong>
      <a routerLink="/" routerLinkActive="on" [routerLinkActiveOptions]="{ exact: true }">Início</a>
      <a routerLink="/perseguicao" routerLinkActive="on">Perseguição</a>
      <a routerLink="/chute" routerLinkActive="on">Chute giratório</a>
    </nav>
    <main><router-outlet /></main>
  `,
  styles: `
    nav { display: flex; gap: 18px; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--line); }
    nav a { color: var(--muted); text-decoration: none; }
    nav a.on { color: var(--text); text-decoration: underline; text-underline-offset: 4px; }
    main { max-width: 1100px; margin: 0 auto; padding: 16px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}

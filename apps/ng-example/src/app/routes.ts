import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./pages/home').then((m) => m.HomePage), title: 'ngx-sprite-fighter' },
  { path: 'perseguicao', loadComponent: () => import('./pages/chase').then((m) => m.ChasePage), title: 'Perseguição' },
  { path: 'chute', loadComponent: () => import('./pages/kick').then((m) => m.KickPage), title: 'Chute giratório' },
  { path: '**', redirectTo: '' },
];

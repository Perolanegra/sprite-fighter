import { NgZone, isDevMode, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { App } from './app/app';
import { routes } from './app/routes';

// Com zona (zone.js), para mostrar que o laço da cena roda fora dela: os quadros não disparam
// detecção de mudanças, só os eventos da cena.
bootstrapApplication(App, {
  providers: [provideZoneChangeDetection({ eventCoalescing: true }), provideRouter(routes, withComponentInputBinding())],
}).then((ref) => {
  // Diagnóstico (só em dev): o teste de navegador conta as detecções de mudanças (a zona ficando
  // estável depois de uma tarefa dentro dela) por aqui.
  if (isDevMode()) (globalThis as { sfExample?: unknown }).sfExample = { zone: ref.injector.get(NgZone) };
});

import { VERSION } from 'sprite-fighter';
import { rigScene } from './scenes/rig';

/**
 * Demo: cada cena é escolhida pela query string (`?scene=rig`, `?scene=poselab&char=neo`).
 * Quando a cena termina de montar, marca <body data-ready="true"> (o `npm run shots` espera isso).
 */
const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'rig';

const scenes: Record<string, (canvas: HTMLCanvasElement, params: URLSearchParams) => Promise<void>> = {
  rig: rigScene,
  poselab: async (canvas, p) => (await import('./scenes/poselab')).poseLabScene(canvas, p),
  anim: async (canvas, p) => (await import('./scenes/anim')).animScene(canvas, p),
  skin: async (canvas, p) => (await import('./scenes/skin')).skinScene(canvas, p),
  chase: async (canvas, p) => (await import('./scenes/script')).scriptScene(canvas, p, 'scenes/chase.json'),
  script: async (canvas, p) => (await import('./scenes/script')).scriptScene(canvas, p, p.get('file') ?? 'scenes/chase.json'),
  variants: async (canvas, p) => (await import('./scenes/variants')).variantsScene(canvas, p),
  combo: async (canvas, p) => (await import('./scenes/combo')).comboScene(canvas, p),
};

async function start(): Promise<void> {
  const app = document.getElementById('app')!;
  const run = scenes[scene];
  if (!run) {
    app.textContent = `sprite-fighter ${VERSION} · cena desconhecida: ${scene} (cenas: ${Object.keys(scenes).join(', ')})`;
    return;
  }
  const canvas = document.createElement('canvas');
  app.replaceChildren(canvas);
  await run(canvas, params);
}

start()
  .catch((err: unknown) => {
    console.error(err);
    const pre = document.createElement('pre');
    pre.className = 'error';
    pre.textContent = err instanceof Error ? err.message : String(err);
    document.body.append(pre);
  })
  .finally(() => {
    document.body.dataset['ready'] = 'true';
  });

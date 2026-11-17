// Mede o custo por quadro das cenas de luta ao vivo (rAF), com WebGL e com o fallback Canvas 2D.
//   node apps/demo/shots/perf.mjs
// O custo = passos de simulação + desenho do quadro (ms). 60 fps pede < 16,7 ms em todo quadro.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const demoRoot = fileURLToPath(new URL('..', import.meta.url));
const runs = [
  { scene: 'combo&only=bg', seconds: 3.2, label: 'base: só o fundo' },
  { scene: 'chase', seconds: 3.6 },
  { scene: 'combo', seconds: 3.2 },
  { scene: 'combo&combo=dash_strike,kick', seconds: 2.4 },
];
const server = await createServer({ root: demoRoot, server: { port: 5184, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
// GPU=1: navegador com janela usando a GPU (no WSL, a GPU real via WSLg/D3D12; o headless só
// tem SwiftShader, GPU emulada por software, que é o pior caso).
const gpu = process.env.GPU === '1';
const browser = await chromium.launch(
  gpu
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] }
    : { args: (process.env.CHROME_ARGS ?? '--disable-gpu-vsync --enable-unsafe-swiftshader').split(' ') },
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(`  erro na página: ${e.message}`));
  for (const r of runs.filter((r) => !process.env.ONLY || r.scene === process.env.ONLY))
    for (const gl of (process.env.GL ?? '1,0').split(','))
    for (let rep = 0; rep < Number(process.env.REPS ?? 2); rep++) {
      await page.goto(`${base}?scene=${r.scene}&perf=1&perfSeconds=${r.seconds}&gl=${gl}${process.env.EXTRA ?? ''}`);
      await page.waitForSelector('body[data-perf]', { timeout: 60000 });
      const p = JSON.parse(await page.getAttribute('body', 'data-perf'));
      if (!rep && gl === '1' && r === runs[0]) console.log('GPU:', await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl'); const e = g?.getExtension('WEBGL_debug_renderer_info'); return g && e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; }));
      console.log(`${(r.label ?? r.scene).padEnd(30)} ${p.renderer.padEnd(9)} quadros ${String(p.frames).padStart(4)} · ${p.fps.toFixed(1)} fps · custo médio ${p.frameMsAvg.toFixed(2)} ms · p95 ${p.frameMsP95.toFixed(2)} ms · máx ${p.frameMsMax.toFixed(2)} ms · > 16,7 ms: ${p.over16ms} · quadros perdidos (≥ 25 ms): ${p.dropped}`);
      if (process.env.PROF) console.log('   ', JSON.stringify(p.perFrameMs), 'perdidos em t =', p.dropAt.join(' '));
    }
} finally {
  await browser.close();
  await server.close();
}

// Perfil de desempenho (o mesmo do painel Performance do Chrome DevTools, via CDP) de uma cena ao vivo.
//   node apps/demo/shots/profile.mjs [scene=chase] [segundos=4]      (GPU=1: navegador com janela e GPU real)
// Grava só com a cena tocando (depois de body[data-ready]). Saída: tempo próprio por função (perfil
// de CPU), por arquivo, e o resumo da timeline por thread
// (thread principal, GPU, compositor). Grava o .cpuprofile e o trace em shots/out/profile/
// (abrem no DevTools → Performance → Load profile).
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const [scene = 'chase', seconds = '4'] = process.argv.slice(2);
const demoRoot = fileURLToPath(new URL('..', import.meta.url));
const outDir = fileURLToPath(new URL('./out/profile/', import.meta.url));
await mkdir(outDir, { recursive: true });
const server = await createServer({ root: demoRoot, server: { port: 5186, strictPort: false }, logLevel: 'error' });
await server.listen();
const gpu = process.env.GPU === '1';
const browser = await chromium.launch(
  gpu ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'] } : { args: ['--disable-gpu-vsync', '--enable-unsafe-swiftshader'] },
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const cdp = await page.context().newCDPSession(page);
  const tag = `${scene}-${gpu ? 'gpu' : 'headless'}${process.env.EXTRA ? '-' + process.env.EXTRA.replace(/[^a-z0-9=]+/gi, '_') : ''}`;
  // Trace (timeline) durante a cena inteira.
  const events = [];
  cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
  const traced = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await page.goto(`${server.resolvedUrls.local[0]}?scene=${scene}&perf=1&perfSeconds=${seconds}${process.env.EXTRA ?? ''}`);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
  // Só a cena tocando (sem o carregamento).
  await cdp.send('Tracing.start', {
    categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'gpu', 'viz', 'toplevel', 'v8.execute', 'blink'].join(','),
    transferMode: 'ReportEvents',
  });
  await cdp.send('Profiler.start');
  await page.waitForSelector('body[data-perf]', { timeout: 60000 });
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.send('Tracing.end');
  await traced;
  const perf = JSON.parse(await page.getAttribute('body', 'data-perf'));
  const renderer = await page.evaluate(() => {
    const g = document.createElement('canvas').getContext('webgl');
    const e = g?.getExtension('WEBGL_debug_renderer_info');
    return g && e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?';
  });
  await writeFile(`${outDir}${tag}.cpuprofile`, JSON.stringify(profile));
  await writeFile(`${outDir}${tag}.trace.json`, JSON.stringify({ traceEvents: events }));

  console.log(`\n${tag} · GPU: ${renderer}`);
  console.log(`quadros ${perf.frames} · ${perf.fps.toFixed(1)} fps · custo JS do quadro ${perf.frameMsAvg.toFixed(2)} ms (p95 ${perf.frameMsP95.toFixed(2)}) · ${JSON.stringify(perf.perFrameMs)}`);

  // --- Perfil de CPU: tempo próprio (self) por função e por arquivo.
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000));
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const fn = new Map(), file = new Map();
  for (const [id, ms] of self) {
    const c = byId.get(id).callFrame;
    const f = c.url ? c.url.replace(/^.*\/(packages|apps|node_modules)\//, '$1/').replace(/\?.*$/, '') : '';
    const key = `${c.functionName || '(anônima)'}  ${f}${f ? ':' + (c.lineNumber + 1) : ''}`;
    fn.set(key, (fn.get(key) ?? 0) + ms);
    const fk = f || c.functionName;
    file.set(fk, (file.get(fk) ?? 0) + ms);
  }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
  const pct = (ms) => `${((ms / total) * 100).toFixed(1).padStart(5)} %  ${ms.toFixed(0).padStart(6)} ms`;
  console.log(`\nCPU (thread principal, ${total.toFixed(0)} ms amostrados) — tempo próprio por função:`);
  for (const [k, ms] of top(fn, 18)) console.log(`  ${pct(ms)}  ${k}`);
  console.log('\npor arquivo:');
  for (const [k, ms] of top(file, 10)) console.log(`  ${pct(ms)}  ${k}`);

  // --- Timeline: tempo próprio (sem os filhos) por evento, em cada thread de interesse.
  const threads = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args.name);
  const per = new Map();
  for (const e of events) {
    if (e.ph !== 'X' || e.dur === undefined) continue;
    const key = `${e.pid}:${e.tid}`;
    (per.get(key) ?? per.set(key, []).get(key)).push(e);
  }
  const frames = perf.frames;
  console.log(`\nTimeline — tempo próprio por thread (ms por quadro; ${frames} quadros):`);
  const rows = [];
  for (const [key, list] of per) {
    const name = threads.get(key) ?? key;
    if (!/CrRendererMain|CrGpuMain|VizCompositorThread|^Compositor$|Raster/i.test(name)) continue;
    list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    const selfBy = new Map();
    const stack = [];
    let busyTotal = 0;
    for (const e of list) {
      while (stack.length && stack[stack.length - 1].end <= e.ts) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent) parent.self -= e.dur;
      else busyTotal += e.dur;
      const node = { name: e.name, end: e.ts + e.dur, self: e.dur };
      stack.push(node);
      node.done = () => selfBy.set(node.name, (selfBy.get(node.name) ?? 0) + node.self);
      (e._n = node);
    }
    for (const e of list) e._n.done();
    rows.push([name, busyTotal / 1000 / frames, selfBy]);
  }
  for (const [name, busyMs, selfBy] of rows.sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ocupada ${busyMs.toFixed(2)} ms/quadro`);
    for (const [k, us] of [...selfBy].sort((a, b) => b[1] - a[1]).slice(0, 7)) console.log(`      ${(us / 1000 / frames).toFixed(2).padStart(6)} ms  ${k}`);
  }
} finally {
  await browser.close();
  await server.close();
}

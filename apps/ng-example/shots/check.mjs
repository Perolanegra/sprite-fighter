// Confere o app de exemplo no navegador (com `npm start -w apps/ng-example` rodando):
//   node apps/ng-example/shots/check.mjs [base=http://localhost:4300]
// 1. perseguição: screenshots em instantes fixos (pause + seek pelo componente) e um ao vivo;
//    conta as detecções de mudanças com a cena tocando (o laço roda fora da zona);
// 2. sai da rota e confere que nada ficou vivo: requestAnimationFrame, contextos WebGL, camadas,
//    ResizeObserver/IntersectionObserver e ouvintes de matchMedia;
// 3. chute giratório: não toca fora da tela, toca ao rolar até ela, pausa ao sair;
// 5. CPU da thread principal (as métricas da aba Performance, via CDP) com a cena tocando e depois de sair;
// 6. play/pause/seek pelo componente (botões da página e métodos).
// 4. DPR 1 e 2: as três camadas mudam de tamanho juntas (CSS × DPR) e a @2x só vem com DPR > 1,5.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4300';
const out = fileURLToPath(new URL('./out/', import.meta.url));
await mkdir(out, { recursive: true });

// Instrumentação: antes de qualquer script da página.
function instrument() {
  const s = (window.__sf = { raf: 0, gl: [], observers: 0, mql: 0, zones: {} });
  const raf = window.requestAnimationFrame.bind(window);
  // Conta os quadros e em que zona cada callback roda ("angular" = dentro da zona do Angular).
  window.requestAnimationFrame = (fn) => (s.raf++, raf((t) => ((s.zones[window.Zone?.current.name ?? '-'] = (s.zones[window.Zone?.current.name ?? '-'] ?? 0) + 1), fn(t))));
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (ctx && /webgl/.test(type) && !s.gl.includes(ctx)) s.gl.push(ctx);
    return ctx;
  };
  for (const name of ['ResizeObserver', 'IntersectionObserver']) {
    const proto = window[name].prototype, observe = proto.observe, disconnect = proto.disconnect, alive = new WeakSet();
    proto.observe = function (...a) {
      if (!alive.has(this)) alive.add(this), s.observers++;
      return observe.apply(this, a);
    };
    proto.disconnect = function () {
      if (alive.delete(this)) s.observers--;
      return disconnect.call(this);
    };
  }
  const add = MediaQueryList.prototype.addEventListener, remove = MediaQueryList.prototype.removeEventListener;
  MediaQueryList.prototype.addEventListener = function (...a) {
    s.mql++;
    return add.apply(this, a);
  };
  MediaQueryList.prototype.removeEventListener = function (...a) {
    s.mql--;
    return remove.apply(this, a);
  };
}

const live = () =>
  page.evaluate(async () => {
    const s = window.__sf;
    const raf0 = s.raf;
    await new Promise((r) => setTimeout(r, 1000));
    return {
      rafPerSecond: s.raf - raf0,
      webglAlive: s.gl.filter((g) => !g.isContextLost()).length,
      webglTotal: s.gl.length,
      observers: s.observers,
      mqlListeners: s.mql,
      canvases: document.querySelectorAll('canvas').length,
    };
  });
// % da thread principal ocupada em `ms` (TaskDuration do CDP = o "CPU" da aba Performance).
const cpu = async (ms = 2000) => {
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const a = await metric();
  await page.waitForTimeout(ms);
  const b = await metric();
  const pct = (k) => +(((b[k] - a[k]) / (ms / 1000)) * 100).toFixed(2);
  return { taskPct: pct('TaskDuration'), scriptPct: pct('ScriptDuration'), layoutPct: pct('LayoutDuration') };
};
const cmp = (fn, arg) => page.evaluate(([f, a]) => new Function('c', 'a', `return (${f})(c, a)`)(ng.getComponent(document.querySelector('sf-scene')), a), [fn.toString(), arg]);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.addInitScript(instrument);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const report = {};
try {
  // 1. Perseguição
  await page.goto(`${base}/perseguicao`);
  await page.waitForSelector('sf-scene[aria-busy="false"]', { timeout: 30000 });
  report.layers = await page.evaluate(() => [...document.querySelectorAll('sf-scene canvas')].map((c) => ({ w: c.width, h: c.height, css: `${c.style.width}×${c.style.height}`, gl: !c.getContext('2d') })));
  // Detecções de mudanças em 1 s de cena tocando.
  report.whilePlaying = await page.evaluate(async () => {
    let cd = 0;
    const sub = window.sfExample.zone.onMicrotaskEmpty.subscribe(() => cd++);
    const s = window.__sf, raf0 = s.raf;
    s.zones = {};
    let steps = 0;
    const el = document.querySelector('sf-scene');
    const onStep = () => steps++;
    ng.getComponent(el).step.subscribe(onStep);
    await new Promise((r) => setTimeout(r, 1000));
    sub.unsubscribe();
    return { frames: s.raf - raf0, rafCallbackZones: s.zones, changeDetections: cd, stepEvents: steps };
  });
  await page.screenshot({ path: `${out}chase-live.png` });
  for (const t of [0.9, 1.6, 2.62, 3.3]) {
    await cmp((c, t) => (c.pause(), c.seek(t)), t);
    await page.locator('sf-scene').screenshot({ path: `${out}chase-${t}.png` });
  }
  // 6. play/pause/seek: pelos botões da página e pelos métodos do componente.
  const state = () => cmp((c) => ({ time: +c.time.toFixed(3), playing: c.playing }));
  const pps = {};
  await page.click('button:has-text("Recomeçar")');
  await page.waitForTimeout(400);
  pps.afterRestart = await state();
  await page.click('button:has-text("Pausar")');
  pps.paused = await state();
  await page.waitForTimeout(500);
  pps.paused500msLater = await state();
  await cmp((c) => c.seek(2));
  pps.seek2 = await state();
  await page.click('button:has-text("Tocar")');
  await page.waitForTimeout(500);
  pps.play500msLater = await state();
  await cmp((c) => c.pause());
  await cmp((c) => c.seek(0.5));
  pps.seekBack = await state();
  report.playPauseSeek = pps;
  // 5. CPU com a cena tocando (laço ligado para não acabar no meio da medição).
  await page.click('button:has-text("Laço")');
  await cmp((c) => c.play());
  report.cpuWhilePlaying = await cpu();
  report.whileOnRoute = await live();
  // 2. Sai da rota
  await page.click('nav a[href="/"]');
  await page.waitForSelector('app-home');
  report.afterLeaving = await live();
  report.cpuAfterLeaving = await cpu();

  // 3. Chute giratório (volta com o roteador: assets já em cache)
  await page.click('nav a[href="/chute"]');
  await page.waitForSelector('sf-scene[aria-busy="false"]', { timeout: 30000 });
  await page.waitForTimeout(800);
  report.kickOffscreen = await cmp((c) => ({ time: c.time, playing: c.playing }));
  await page.locator('sf-scene').scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  report.kickVisible = await cmp((c) => ({ time: c.time, playing: c.playing }));
  await page.locator('sf-scene').screenshot({ path: `${out}kick-live.png` });
  await cmp((c, t) => (c.pause(), c.seek(t)), 0.62);
  await page.locator('sf-scene').screenshot({ path: `${out}kick-0.62.png` });
  await cmp((c) => c.play());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  report.kickScrolledAway = await cmp((c) => ({ time: c.time, playing: c.playing }));
  await page.click('nav a[href="/"]');
  await page.waitForSelector('app-home');
  report.afterLeavingKick = await live();

  // 4. Redimensionar, DPR e texturas @2x
  for (const dpr of [1, 2]) {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: dpr });
    const p = await ctx.newPage();
    const webp = [];
    p.on('request', (r) => r.url().endsWith('.webp') && webp.push(r.url().split('/').pop()));
    await p.goto(`${base}/perseguicao`);
    await p.waitForSelector('sf-scene[aria-busy="false"]', { timeout: 30000 });
    const sizes = () => p.evaluate(() => [...document.querySelectorAll('sf-scene canvas')].map((c) => `${c.width}x${c.height} (${c.style.width} ${c.style.height})`));
    const before = await sizes();
    await p.setViewportSize({ width: 640, height: 700 });
    await p.waitForTimeout(300);
    report[`dpr${dpr}`] = { before, after: await sizes(), webp: [...new Set(webp)] };
    await ctx.close();
  }
} finally {
  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

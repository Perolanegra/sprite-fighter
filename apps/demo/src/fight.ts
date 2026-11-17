import { CanvasRenderer, FixedClock, SIM_DT, World, drawParallax, drawProjectiles, parseMoves, runLoop, type MoveData, type ParallaxLayer } from '@perolanegra/sprite-fighter';
import { drawFightDebug } from '@perolanegra/sprite-fighter/authoring';
import type { CharName } from './assets';

/** Golpes de um personagem (assets/moves/<char>.moves.json); sem o arquivo, nenhum golpe. */
export async function loadMoves(name: CharName): Promise<Map<string, MoveData>> {
  const res = await fetch(`/moves/${name}.moves.json`);
  // Arquivo que não existe: 404 ou, no servidor de dev do Vite, o index.html com 200.
  if (res.status === 404 || !res.headers.get('content-type')?.includes('json')) return new Map();
  if (!res.ok) throw new Error(`golpes de ${name}: falha ao carregar assets/moves/${name}.moves.json (${res.status})`);
  return parseMoves(await res.json(), `golpes ${name}`);
}

/** Uma cena de luta da demo: o World, o roteiro (chamado antes de cada passo) e o desenho. */
export interface FightSetup {
  world: World;
  /** Roteiro: roda antes de cada passo, com o tempo da cena (s, tempo real). */
  script(t: number): void;
  /** Cenário em paralaxe (atrás de tudo). */
  parallax?: ParallaxLayer[];
  /** Props (antes dos personagens) e o que vem por cima. */
  drawBack?(r: CanvasRenderer): void;
  drawFront?(r: CanvasRenderer): void;
  /** Ordem de desenho dos personagens (ids); padrão: ordem do World. */
  order?: string[];
  title: string;
}

/**
 * Executa uma cena de luta. A câmera é a do World (automática, dirigida pelo roteiro).
 * Parâmetros comuns:
 *  - `&t=1.2`: simula até 1,2 s (determinístico) e congela (screenshots);
 *  - `&at=hit:2+6` / `hit:2-3`: o 2º contato mais (ou menos) N frames de 60 fps;
 *  - `&at=pose:smith:1+2`: a 1ª troca de pose do smith mais 2 frames;
 *  - `&debug=1` (ossos, hurtboxes, hitboxes, pose/fase) e `&mesh=1`; `&gl=0` = Canvas 2D;
 *  - `&perf=1`: roda ao vivo e mede o custo de cada quadro (resultado em body[data-perf]);
 *    `&only=clear|sky|bg` desenha só até ali (o teto do ambiente, para comparar);
 *  - `&layers=0`: WebGL composto no canvas 2D (sem camadas no DOM).
 */
export async function runFight(canvas: HTMLCanvasElement, params: URLSearchParams, build: (r: CanvasRenderer) => Promise<FightSetup>): Promise<void> {
  const renderer = new CanvasRenderer(canvas);
  renderer.useWebGL = params.get('gl') !== '0';
  renderer.resize(innerWidth, innerHeight);
  // Ao vivo, WebGL em camada própria no DOM (sem copiar para o canvas 2D); `&layers=0` desliga.
  // Screenshots (&t / &at) desenham um quadro só, composto no canvas.
  const still = params.has('t') || params.has('at');
  if (!still && params.get('layers') !== '0') renderer.useLayers();
  renderer.background = '#1b2333';
  const debug = params.get('debug') === '1';
  const mesh = params.get('mesh') === '1';
  let setup: FightSetup;
  let t = 0;
  let steps = 0;
  const init = async () => {
    setup = await build(renderer);
    for (const f of setup.world.fighters.values()) renderer.preload(f.actor.character);
    setup.world.camera.width = renderer.width;
    setup.world.camera.height = renderer.height;
    t = 0;
    steps = 0;
  };
  await init();
  const step = (dt: number) => {
    setup.script(t);
    setup.world.step(dt);
    t += dt;
    steps++;
  };
  let hudExtra = '';
  // Custo por etapa do desenho (ms acumulados), para o &perf=1.
  const prof: Record<string, number> = {};
  let mark = 0;
  const lap = (name: string) => {
    const now = performance.now();
    prof[name] = (prof[name] ?? 0) + now - mark;
    mark = now;
  };
  const render = (alpha: number) => {
    const w = setup.world;
    mark = performance.now();
    renderer.camera = w.camera.view(alpha);
    renderer.clear();
    const only = params.get('only');
    if (only === 'clear') return;
    drawSky(renderer);
    lap('céu');
    if (only === 'sky') return;
    if (setup.parallax) drawParallax(renderer, setup.parallax, w.realTime);
    if (only === 'bg') return;
    lap('paralaxe');
    w.fx.drawBack(renderer);
    setup.drawBack?.(renderer);
    lap('fundo');
    const ids = setup.order ?? [...w.fighters.keys()];
    renderer.batch(() => {
      for (const id of ids) w.fighter(id).actor.draw(renderer, alpha);
    });
    lap('personagens');
    drawProjectiles(renderer, w);
    w.fx.drawFront(renderer);
    setup.drawFront?.(renderer);
    lap('efeitos');
    if (debug) drawFightDebug(renderer, w, { mesh });
    const last = w.hits[w.hits.length - 1];
    const slow = w.timeScale < 0.999 ? ` · câmera lenta ×${w.timeScale.toFixed(2)}` : '';
    const stop = [...w.fighters.values()].filter((f) => f.hitstop > 0).map((f) => f.id);
    hud(
      renderer,
      `${setup.title} · ${t.toFixed(3)} s (frame ${Math.round(t * 60)}) · ${renderer.webGL ? (renderer.layered ? 'WebGL (camadas)' : 'WebGL') : 'Canvas 2D'} · contatos: ${w.hits.length}${last ? ` (último: ${last.attacker}→${last.target} ${last.move ?? ''})` : ''}${stop.length ? ` · HITSTOP ${stop.join('+')}` : ''}${slow}${hudExtra}${debug ? ` · câm ${renderer.camera.x.toFixed(0)},${renderer.camera.y.toFixed(0)} ×${renderer.camera.zoom.toFixed(3)}` : ''}`,
    );
  };

  const at = params.get('at');
  const shotTime = params.get('t');
  if (at !== null || shotTime !== null) {
    const max = Math.round(20 / SIM_DT);
    const frames = (f: string | undefined) => Math.round(Number(f ?? 0) / 60 / SIM_DT);
    if (at !== null) {
      const spec = at.replace(' ', '+'); // '+' na URL vira espaço
      const hit = /^hit:(\d+)([+-]\d+)?$/.exec(spec);
      const pose = /^pose:([\w-]+):(\d+)([+-]\d+)?$/.exec(spec);
      if (!hit && !pose) throw new Error(`&at= esperado no formato hit:N±frames ou pose:<id>:N±frames (veio "${at}")`);
      const reached = () => (hit ? setup.world.hits.length >= Number(hit[1]) : setup.world.fighter(pose![1]!).actor.poseChanges >= Number(pose![2]));
      let i = 0;
      while (!reached() && i++ < max) step(SIM_DT);
      if (!reached()) throw new Error(`a cena terminou antes de ${at}`);
      // Frames negativos: recomeça e para antes (o seek é re-simular do início).
      const target = steps + frames(hit ? hit[2] : pose![3]);
      await init();
      while (steps < target) step(SIM_DT);
    } else for (let i = 0, n = Math.round(Number(shotTime) / SIM_DT); i < n; i++) step(SIM_DT);
    render(1);
    return;
  }

  const clock = new FixedClock();
  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;left:8px;bottom:8px;display:flex;gap:6px';
  const btn = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:#2a2c38cc;color:#e3e4ea;border:1px solid #3a3d4d;border-radius:6px;padding:6px 10px;font:inherit;cursor:pointer';
    b.onclick = fn;
    ui.append(b);
    return b;
  };
  btn('recomeçar', () => void init());
  btn('câmera lenta', () => (clock.timeScale = clock.timeScale === 1 ? 0.2 : 1));
  btn('pausa', () => (clock.paused = !clock.paused));
  document.body.append(ui);

  // Medidor: FPS (intervalo entre quadros) e custo do quadro (passos + desenho), média e p95.
  const perf = params.get('perf') === '1';
  const perfSeconds = Number(params.get('perfSeconds') ?? 5);
  const costs: number[] = [], gaps: number[] = [], dropAt: number[] = [];
  let lastFrame = 0, costNow = 0;
  const timedStep = (dt: number) => {
    const a = performance.now();
    step(dt);
    const d = performance.now() - a;
    costNow += d;
    prof['simulação'] = (prof['simulação'] ?? 0) + d;
  };
  const warmup = Number(params.get('warmup') ?? 0.3);
  const timedRender = (alpha: number) => {
    const a = performance.now();
    render(alpha);
    costNow += performance.now() - a;
    if (perf && t < warmup) {
      // Aquecimento (texturas subindo, primeiras compilações): fora da medida.
      costNow = 0;
      lastFrame = a;
      return;
    }
    if (lastFrame) {
      gaps.push(a - lastFrame);
      if (a - lastFrame >= 25) dropAt.push(+t.toFixed(2));
    }
    lastFrame = a;
    costs.push(costNow);
    costNow = 0;
    if (costs.length % 30 === 0) {
      const g = gaps.slice(-60), c = costs.slice(-60);
      hudExtra = ` · ${(1000 / (g.reduce((x, y) => x + y, 0) / g.length)).toFixed(0)} fps · quadro ${(c.reduce((x, y) => x + y, 0) / c.length).toFixed(1)} ms`;
    }
    if (perf && t >= perfSeconds && !document.body.dataset['perf']) {
      const sorted = [...costs].sort((x, y) => x - y), sg = [...gaps].sort((x, y) => x - y);
      const q = (arr: number[], k: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * k))]!;
      document.body.dataset['perf'] = JSON.stringify({
        renderer: renderer.webGL ? 'webgl' : 'canvas2d',
        frames: costs.length,
        fps: 1000 / (gaps.reduce((x, y) => x + y, 0) / gaps.length),
        frameMsAvg: costs.reduce((x, y) => x + y, 0) / costs.length,
        frameMsP95: q(sorted, 0.95),
        frameMsMax: sorted[sorted.length - 1],
        gapMsP95: q(sg, 0.95),
        dropped: gaps.filter((g) => g >= 25).length,
        dropAt,
        over16ms: costs.filter((c) => c > 16.7).length,
        perFrameMs: Object.fromEntries(Object.entries(prof).map(([k, v]) => [k, +(v / costs.length).toFixed(2)])),
      });
    }
  };
  runLoop(clock, timedStep, timedRender);
}

function hud(r: CanvasRenderer, text: string): void {
  const { ctx } = r;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `${13 * r.dpr}px system-ui, sans-serif`;
  ctx.fillText(text, 12 * r.dpr, 22 * r.dpr);
}

/** Céu em gradiente (fixo na tela). */
export function drawSky(r: CanvasRenderer): void {
  const { ctx } = r;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, r.canvas.height);
  g.addColorStop(0, '#0f1730');
  g.addColorStop(0.65, '#2b3a62');
  g.addColorStop(1, '#4a4f72');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, r.canvas.width, r.canvas.height);
}

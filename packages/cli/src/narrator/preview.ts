import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import sharp from 'sharp';
import { Director, parseScript } from '@perolanegra/sprite-fighter';
import { checkActions, readDeclaredActions, type DeclaredAction } from './actions.js';
import { loadCast } from './assets.js';
import { startLab } from '../lab/server.js';

export interface KeyTime {
  t: number;
  label: string;
}

/** Comandos que mudam o que se vê (o instante logo depois de começarem vale um quadro). */
const SHOW: Record<string, number> = { pose: 0.1, move: 0.18, enter: 0.25, exit: 0.3, spawnProp: 0.3, prop: 0.15, expression: 0.05, hand: 0.05, touch: 0.05, fall: 0.3, say: 0.2 };

/**
 * Tempos-chave de uma cena, pela simulação seca: logo depois de cada passo que muda o que se vê,
 * cada contato (+2 frames) e o fim. Instantes a menos de 0,2 s se juntam; no máximo `max`.
 */
export async function keyTimes(scene: unknown, assetsDir: string, max = 12, actions: DeclaredAction[] | null = null): Promise<{ times: KeyTime[]; duration: number }> {
  const script = parseScript(scene, 'cena');
  const cast = await loadCast(assetsDir, [...script.cast.keys()]);
  checkActions(cast.characters, actions); // ações do app: vazias na simulação seca (o validate é quem reporta)
  const d = await Director.create(script, { ...cast, onWarning: () => {} }, 'cena');
  const raw: KeyTime[] = [{ t: 0.1, label: 'início' }];
  d.reset();
  d.on('step', (e: { do: string; actor: string | null; params: Record<string, unknown>; phase: string; time: number }) => {
    if (e.phase !== 'start' || !(e.do in SHOW)) return;
    const p = e.params;
    const what = e.do === 'prop' ? `${p['id']} ${p['action']}` : (p['name'] ?? p['id'] ?? p['type'] ?? p['prop'] ?? '');
    raw.push({ t: e.time + SHOW[e.do]!, label: `${e.actor ? `${e.actor}: ` : ''}${e.do}${what ? ` ${what}` : ''}` });
  });
  d.on('hit', (e: { attacker: string; target: string; time: number }) => raw.push({ t: d.time + 2 / 60, label: `hit ${e.attacker}→${e.target}` }));
  while (d.time < d.duration - 1e-9) d.step();
  raw.push({ t: Math.max(0, d.duration - 0.05), label: 'fim' });
  raw.sort((a, b) => a.t - b.t);
  const merged: KeyTime[] = [];
  for (const k of raw) {
    const last = merged[merged.length - 1];
    if (last && k.t - last.t < 0.2) last.label = [...new Set(`${last.label} · ${k.label}`.split(' · '))].join(' · ');
    else merged.push({ t: Math.min(k.t, d.duration), label: k.label });
  }
  // Muitos: amostra uniforme, mantendo o primeiro e o último.
  const times = merged.length <= max ? merged : Array.from({ length: max }, (_, i) => merged[Math.round((i * (merged.length - 1)) / (max - 1))]!);
  return { times: times.map((k) => ({ t: +k.t.toFixed(3), label: k.label })), duration: d.duration };
}

/**
 * `preview <cena>`: screenshots da cena nos tempos-chave (pela demo, com seek determinístico) e uma
 * folha de contato. A cena precisa estar em <assets>/scenes/. Erros da página são devolvidos.
 */
export async function runPreview(scenePath: string, o: { root: string; assetsDir: string; times?: number[]; debug?: boolean }): Promise<{ dir: string; shots: { file: string; t: number; label: string }[]; sheet: string; pageErrors: string[] }> {
  const sceneRel = relative(o.assetsDir, scenePath);
  if (sceneRel.startsWith('..') || !sceneRel.startsWith('scenes/')) throw new Error(`a cena precisa estar em ${join(o.assetsDir, 'scenes')} (a demo serve essa pasta)`);
  const scene = JSON.parse(readFileSync(scenePath, 'utf8'));
  const times = o.times ? o.times.map((t) => ({ t, label: '' })) : (await keyTimes(scene, o.assetsDir, 12, readDeclaredActions(o.root))).times;
  const name = basename(scenePath, '.json');
  const dir = join(o.root, '.sf', 'preview', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const chromium = await loadChromium();
  // O lab (a demo compilada) serve a pasta de assets do projeto, numa porta livre.
  const lab = await startLab({ assetsDir: o.assetsDir, projectRoot: o.root, port: 0 });
  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  const shots: { file: string; t: number; label: string }[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    for (const [i, k] of times.entries()) {
      await page.goto(`${lab.url}?scene=script&file=${sceneRel}&t=${k.t}${o.debug ? '&debug=1' : ''}`);
      await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
      const err = await page.$('pre.error');
      if (err) pageErrors.push(`t=${k.t}: ${await err.textContent()}`);
      const file = join(dir, `${String(i + 1).padStart(2, '0')}-t${k.t.toFixed(2)}.png`);
      await page.screenshot({ path: file });
      shots.push({ file, t: k.t, label: k.label });
    }
  } finally {
    await browser.close();
    await lab.close();
  }
  const sheet = join(dir, 'contato.png');
  await contactSheet(shots, sheet);
  return { dir, shots, sheet, pageErrors };
}

/** Playwright é opcional (só a prévia usa): mensagem clara se não estiver instalado. */
async function loadChromium(): Promise<typeof import('playwright').chromium> {
  try {
    return (await import('playwright')).chromium;
  } catch {
    throw new Error('a prévia precisa do Playwright: npm i -D playwright && npx playwright install chromium');
  }
}

/** Folha de contato: 3 colunas, cada quadro com o tempo e o que acontece. */
async function contactSheet(shots: { file: string; t: number; label: string }[], out: string): Promise<void> {
  const W = 640, H = 360, LH = 26, cols = 3;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tiles = await Promise.all(
    shots.map(async (s, i) => {
      const img = await sharp(s.file).resize(W, H).toBuffer();
      const label = Buffer.from(`<svg width="${W}" height="${LH}"><rect width="100%" height="100%" fill="#000"/><text x="8" y="18" font-size="15" font-family="sans-serif" fill="#ffd23f">${esc(`t=${s.t.toFixed(2)} s${s.label ? ` · ${s.label}` : ''}`)}</text></svg>`);
      const x = (i % cols) * W, y = Math.floor(i / cols) * (H + LH);
      return [{ input: label, left: x, top: y }, { input: img, left: x, top: y + LH }];
    }),
  );
  const rows = Math.ceil(shots.length / cols);
  await sharp({ create: { width: cols * W, height: rows * (H + LH), channels: 3, background: '#111' } }).composite(tiles.flat()).png().toFile(out);
}

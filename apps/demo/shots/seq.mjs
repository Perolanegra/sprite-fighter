// Sequências quadro a quadro (frames de 60 fps) em folhas de contato rotuladas.
//   node apps/demo/shots/seq.mjs [nome…]   → sequências de seq.json (todas ou só as citadas)
// Cada sequência: { name, query, at: "pose:smith:1" | "hit:2", from, to, crop?: [x,y,w,h], cols? }
// Os quadros usam &at=<at>±F; saída em apps/demo/shots/out/seq/<nome>.png.
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { createServer } from 'vite';

const demoRoot = fileURLToPath(new URL('..', import.meta.url));
const outDir = fileURLToPath(new URL('./out/seq/', import.meta.url));
const all = JSON.parse(await readFile(new URL('./seq.json', import.meta.url), 'utf8'));
const pick = process.argv.slice(2);
const seqs = pick.length ? all.filter((s) => pick.includes(s.name)) : all;

await mkdir(outDir, { recursive: true });
const server = await createServer({ root: demoRoot, server: { port: 5183, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(`  erro na página: ${e.message}`));
  for (const s of seqs) {
    const [cx, cy, cw, ch] = s.crop ?? [190, 110, 900, 500];
    const scale = s.scale ?? 0.6;
    const tw = Math.round(cw * scale), th = Math.round(ch * scale);
    const tiles = [];
    for (let f = s.from; f <= s.to; f++) {
      const at = `${s.at}${f < 0 ? f : `%2B${f}`}`;
      await page.goto(`${base}?${s.query}&at=${at}`);
      await page.waitForSelector('body[data-ready="true"]', { timeout: 20000 });
      const err = await page.$('pre.error');
      if (err) throw new Error(`${s.name} f=${f}: ${await err.textContent()}`);
      const png = await page.screenshot();
      const label = Buffer.from(`<svg width="${tw}" height="26"><rect width="100%" height="100%" fill="black" opacity="0.65"/><text x="8" y="19" font-family="sans-serif" font-size="16" fill="white">${s.at} ${f >= 0 ? '+' : ''}${f} f</text></svg>`);
      tiles.push(await sharp(png).extract({ left: cx, top: cy, width: cw, height: ch }).resize(tw, th).composite([{ input: label, top: 0, left: 0 }]).png().toBuffer());
    }
    const cols = s.cols ?? 4, rows = Math.ceil(tiles.length / cols), gap = 4;
    const sheet = sharp({ create: { width: cols * (tw + gap) - gap, height: rows * (th + gap) - gap, channels: 3, background: '#000' } });
    const file = `${outDir}${s.name}.png`;
    await sheet.composite(tiles.map((input, i) => ({ input, left: (i % cols) * (tw + gap), top: Math.floor(i / cols) * (th + gap) }))).png().toFile(file);
    console.log(`  ${s.name} (${tiles.length} quadros) → ${file}`);
  }
} finally {
  await browser.close();
  await server.close();
}

// Tira screenshots da demo em momentos definidos pela query string (ex.: ?scene=chase&t=1.2).
//   npm run shots                       → todos os itens de shots.json
//   npm run shots -- "scene=chase&t=1.2" "scene=poselab"
// As imagens vão para apps/demo/shots/out/. A página avisa que está pronta com <body data-ready="true">.
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const demoRoot = fileURLToPath(new URL('..', import.meta.url));
const outDir = fileURLToPath(new URL('./out/', import.meta.url));
const width = Number(process.env.SHOTS_WIDTH ?? 1280);
const height = Number(process.env.SHOTS_HEIGHT ?? 720);

const args = process.argv.slice(2);
const shots = args.length
  ? args.map((query) => ({ name: query.replace(/[^a-z0-9.=-]+/gi, '_') || 'empty', query }))
  : JSON.parse(readFileSync(new URL('./shots.json', import.meta.url), 'utf8'));

await mkdir(outDir, { recursive: true });
const server = await createServer({ root: demoRoot, server: { port: 5182, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(`  erro na página: ${e.message}`));
  for (const shot of shots) {
    await page.goto(`${base}?${shot.query}`);
    await page.waitForSelector('body[data-ready="true"]', { timeout: 15000 });
    const file = `${outDir}${shot.name}.png`;
    await page.screenshot({ path: file });
    console.log(`  ${shot.name} → ${file}`);
  }
} finally {
  await browser.close();
  await server.close();
}

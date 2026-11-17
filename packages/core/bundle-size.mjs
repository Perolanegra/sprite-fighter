// Tamanho do bundle do core contra o orçamento do PLANO.md (gzip do player).
//   npm run size        (depois do npm run build -w packages/core)
// Empacota o dist com o Vite (minificado, ES module) e mede o gzip nível 9:
//  - player: tudo o que `sprite-fighter` exporta (é o que o orçamento mede);
//  - uso típico: Scene + Character + parseMoves + parseClip (o resto sai no tree-shaking);
//  - autoria: quanto `sprite-fighter/authoring` acrescenta ao player (fica fora do bundle do player).
import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Orçamento do player (gzip): o medido em 2026-11-17 (49,5 KB) + 10 % de margem. */
const BUDGET_KB = 54.5;
const index = fileURLToPath(new URL('./dist/index.js', import.meta.url));
const authoring = fileURLToPath(new URL('./dist/authoring.js', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'sf-size-'));
const entry = (name, code) => {
  const file = join(tmp, `${name}.js`);
  writeFileSync(file, code);
  return file;
};
const typical = entry('typical', `import { Scene, Character, parseMoves, parseClip } from ${JSON.stringify(index)};\nglobalThis.sf = { Scene, Character, parseMoves, parseClip };\n`);
const both = entry('both', `export * from ${JSON.stringify(index)};\nexport * from ${JSON.stringify(authoring)};\n`);

async function gz(name, file) {
  const outDir = join(tmp, `out-${name}`);
  await build({ logLevel: 'silent', configFile: false, build: { outDir, emptyOutDir: true, minify: true, lib: { entry: file, formats: ['es'], fileName: 'bundle' } } });
  const code = readFileSync(join(outDir, 'bundle.js'));
  return { min: code.length / 1024, gz: gzipSync(code, { level: 9 }).length / 1024 };
}

const player = await gz('player', index);
const usage = await gz('typical', typical);
const all = await gz('both', both);
const row = (label, r, note = '') => console.log(`${label.padEnd(20)} ${r.min.toFixed(1).padStart(6)} KB minificado · ${r.gz.toFixed(1).padStart(5)} KB gzip ${note}`);
row('player', player, player.gz <= BUDGET_KB ? `(ok, orçamento ${BUDGET_KB} KB)` : `(ACIMA do orçamento de ${BUDGET_KB} KB)`);
row('uso típico', usage);
row('+ authoring', { min: all.min - player.min, gz: all.gz - player.gz }, '(a mais, só para quem importa sprite-fighter/authoring)');
rmSync(tmp, { recursive: true, force: true });
if (player.gz > BUDGET_KB) process.exitCode = 1;

#!/usr/bin/env node
/**
 * sf-narrate: ferramentas determinísticas (sem IA) para cenas escritas a partir de uma narrativa.
 * Quem escreve a cena é o Claude Code, pelo comando /narrate (.claude/commands/narrate.md).
 *
 *   npm run narrate -- catalog                    o que existe: personagens, poses (e variantes,
 *                                                  provisórias), golpes, clipes, efeitos, props, comandos, eventos
 *   npm run narrate -- validate scenes/x.json     formato, nomes contra o catálogo, duração, avisos e
 *                                                  simulação seca (+ coerência com scenes/x.narrative.json)
 *   npm run narrate -- missing scenes/x.json      cria as provisórias declaradas e gera scenes/x.missing.md
 *                                                  com os prompts de imagem (do manifesto) e os pose:add
 *   npm run narrate -- preview scenes/x.json      screenshots nos tempos-chave + folha de contato
 *
 * Opções: validate --json; missing --no-provisional; preview --times 0.5,1.2 --debug.
 * Saída ≠ 0 quando há erro (validate com erro, página com erro no preview).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildCatalog } from './catalog.js';
import { runMissing } from './missing.js';
import { narrativeFor } from './narrative.js';
import { runPreview } from './preview.js';
import { validateScene } from './validate.js';
import { readDeclaredActions } from './actions.js';

const root = process.env['INIT_CWD'] ?? process.cwd();
const assetsDir = resolve(root, process.env['SF_ASSETS'] ?? 'assets');
const [cmd, target, ...rest] = process.argv.slice(2);
const flag = (f: string) => rest.includes(f);
const get = (f: string) => (rest.includes(f) ? rest[rest.indexOf(f) + 1] : undefined);

/** `scenes/x.json` é relativo a assets/; outros caminhos, à raiz. */
const scenePath = (p: string) => (p.startsWith('scenes/') ? join(assetsDir, p) : resolve(root, p));
const show = (p: string) => p.replace(`${root}/`, '');

async function main(): Promise<number> {
  if (cmd === 'catalog') {
    console.log(JSON.stringify(buildCatalog(assetsDir, readDeclaredActions(root)), null, 2));
    return 0;
  }
  if (!target || !['validate', 'missing', 'preview'].includes(cmd ?? '')) {
    console.error('uso: npm run narrate -- catalog | validate <cena.json> [--json] | missing <cena.json> [--no-provisional] | preview <cena.json> [--times a,b] [--debug]');
    return 1;
  }
  const file = scenePath(target);
  const scene = JSON.parse(readFileSync(file, 'utf8'));

  if (cmd === 'validate') {
    const { file: side, narrative } = narrativeFor(file);
    const v = await validateScene(scene, { assetsDir, narrative, actions: readDeclaredActions(root) });
    if (flag('--json')) console.log(JSON.stringify(v, null, 2));
    else {
      console.log(`${v.ok ? 'OK' : 'ERROS'} · ${show(file)}${narrative ? ` (+ ${show(side)})` : ''} · duração ${v.duration?.toFixed(2) ?? '?'} s`);
      if (Object.keys(v.events).length) console.log(`eventos: ${Object.entries(v.events).map(([k, n]) => `${k} ×${n}`).join(', ')}`);
      for (const e of v.errors) console.log(`  ERRO: ${e}`);
      for (const w of v.warnings) console.log(`  aviso: ${w}`);
    }
    return v.ok ? 0 : 1;
  }

  if (cmd === 'missing') {
    const r = await runMissing(file, { assetsDir, provisional: !flag('--no-provisional') });
    for (const c of r.created) console.log(`pose "${c.name}" (${c.char}) não existe: gravada como provisória a partir de "${c.from}"`);
    for (const c of r.converted) console.log(`poseMap: ${c} agora é "provisional"`);
    const n = r.poses.length + r.variants.length + r.moves.length;
    if (!n) console.log('nada falta: todas as poses da cena têm imagem');
    for (const p of r.poses) console.log(`  pose ${p.char}/${p.pose} (${p.status})`);
    for (const p of r.variants) console.log(`  variante ${p.char}/${p.pose}`);
    for (const m of r.moves) console.log(`  golpe ${m.char}/${m.name}`);
    console.log(`prompts de imagem e comandos pose:add em ${show(r.file)}`);
    return 0;
  }

  const times = get('--times')?.split(',').map(Number);
  const r = await runPreview(file, { root, assetsDir, ...(times ? { times } : {}), debug: flag('--debug') });
  for (const s of r.shots) console.log(`  t=${s.t.toFixed(2)} s  ${s.label.padEnd(40)} ${show(s.file)}`);
  console.log(`folha de contato: ${show(r.sheet)}`);
  for (const e of r.pageErrors) console.log(`  ERRO na página: ${e}`);
  return r.pageErrors.length ? 1 : 0;
}

main().then(
  (code) => (process.exitCode = code),
  (e: unknown) => {
    console.error(`erro: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  },
);

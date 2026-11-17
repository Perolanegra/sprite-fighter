#!/usr/bin/env node
/**
 * sf: o CLI do sprite-fighter (pacote @perolanegra/sprite-fighter-cli). Trabalha nos assets do projeto
 * de onde é chamado; a pasta é `--assets <pasta>`, SF_ASSETS, o `assets` do sf.config.json, ou `assets/`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPoseAdd } from './atlas/add.js';
import { runPoseList } from './atlas/list.js';
import { runNormalize, runPose } from './atlas/pose.js';
import { runSheet } from './atlas/sheet.js';
import { runInit } from './init.js';
import { startLab } from './lab/server.js';
import { runNarrator } from './narrator/run.js';
import { assetsDir, assetsRel, projectRoot } from './paths.js';

const HELP = `sf: CLI do sprite-fighter

  sf init [--assets <pasta>]                   prepara o projeto (assets, clipes, sf.config.json, sf.actions.json, /narrate)
  sf lab [--port 5180]                         Pose Lab, tira de poses e cenas no navegador

Poses:
  sf pose:add --char <id> --pose <p> --src <png> [--dir poses/<coleção>/<id>] [--skeleton <id>|humanoide]
              [--rect x,y,w,h] [--description "…"] [--tags a,b] [--replace]
  sf pose:add --char <id> --pose <p> --variant <v> --kind expression|hand --src <png>
  sf pose:list --char <id> [--provisional]     poses, situação e prompts de imagem
  sf normalize --char <id>                     escala de todas as poses pela altura da cabeça
  sf pose <png> --char <id> --pose <p>         só recorta e registra (o pose:add chama este)
  sf sheet <folha.png> --char <id>             folha de peças → atlas (rig de peças, opcional)

Cenas:
  sf catalog                                   tudo o que um roteiro pode usar (JSON)
  sf validate <cena> [--json]                  formato, nomes, ações, simulação seca
  sf missing <cena> [--no-provisional]         provisórias + <cena>.missing.md com os prompts
  sf preview <cena> [--times a,b] [--debug]    screenshots + folha de contato (precisa do Playwright)

Opção de todos: --assets <pasta> (ou SF_ASSETS, ou "assets" no sf.config.json; padrão assets/).`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const root = projectRoot();
  // Pasta de assets: --assets > SF_ASSETS > sf.config.json > assets/ (fica em SF_ASSETS para todos os módulos).
  const ai = argv.indexOf('--assets');
  const cmd = argv[0];
  if (ai >= 0 && cmd !== 'init') {
    process.env['SF_ASSETS'] = argv[ai + 1];
    argv.splice(ai, 2);
  } else if (!process.env['SF_ASSETS'] && existsSync(join(root, 'sf.config.json'))) {
    const cfg = JSON.parse(readFileSync(join(root, 'sf.config.json'), 'utf8')) as { assets?: string };
    if (cfg.assets) process.env['SF_ASSETS'] = cfg.assets;
  }
  const rest = argv.slice(1);
  switch (cmd) {
    case 'init':
      runInit(rest, root);
      return 0;
    case 'lab': {
      const pi = rest.indexOf('--port');
      const lab = await startLab({ assetsDir: assetsDir(root), projectRoot: root, port: pi >= 0 ? Number(rest[pi + 1]) : 5180 });
      console.log(`lab em ${lab.url} (assets: ${assetsRel(root)}/) · Ctrl+C para parar`);
      await new Promise(() => {});
      return 0;
    }
    case 'pose:add':
      await runPoseAdd(rest, root);
      return 0;
    case 'pose:list':
      await runPoseList(rest, root);
      return 0;
    case 'normalize':
      await runNormalize(rest, root);
      return 0;
    case 'pose':
      await runPose(rest, root);
      return 0;
    case 'sheet':
      await runSheet(rest);
      return 0;
    case 'catalog':
    case 'validate':
    case 'missing':
    case 'preview':
      return runNarrator(cmd, rest);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return 0;
    default:
      console.error(`comando desconhecido: ${cmd}\n\n${HELP}`);
      return 1;
  }
}

main().then(
  (code) => (process.exitCode = code),
  (err: unknown) => {
    console.error(`erro: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));

/**
 * `sf init [--assets <pasta>] [--force]`: prepara um app para o sprite-fighter.
 *  - a pasta de assets (`--assets`; sem ela, a do sf.config.json, se houver; senão `assets/`; num app
 *    Angular, algo como `public/sf`) com skins/, poses/,
 *    moves/, scenes/ e a biblioteca de clipes genéricos (clips/: idle_fly, hurt_light…);
 *  - `sf.config.json` com a pasta (os outros comandos a leem);
 *  - `sf.actions.json` de exemplo (ações TS do app para o validate e o /narrate);
 *  - `.claude/commands/narrate.md` (o comando /narrate do Claude Code).
 * Não sobrescreve nada que já exista (só com --force).
 */
export function runInit(argv: string[], root: string): void {
  // Pasta: --assets; senão, a do sf.config.json (rodar o init de novo não cria outra); senão, assets/.
  const i = argv.indexOf('--assets');
  const cfgFile = join(root, 'sf.config.json');
  const configured = existsSync(cfgFile) ? (JSON.parse(readFileSync(cfgFile, 'utf8')) as { assets?: string }).assets : undefined;
  const assets = i >= 0 ? argv[i + 1]! : (configured ?? 'assets');
  const force = argv.includes('--force');
  const done: string[] = [], kept: string[] = [];
  const put = (file: string, write: () => void) => {
    if (existsSync(file) && !force) return kept.push(relative(root, file));
    write();
    done.push(relative(root, file));
  };

  const dir = resolve(root, assets);
  const rel = relative(root, dir) || '.';
  for (const d of ['skins', 'poses', 'moves', 'scenes', 'clips']) mkdirSync(join(dir, d), { recursive: true });
  for (const f of readdirSync(join(TEMPLATES, 'clips'))) put(join(dir, 'clips', f), () => copyFileSync(join(TEMPLATES, 'clips', f), join(dir, 'clips', f)));
  put(join(root, 'sf.config.json'), () => writeFileSync(join(root, 'sf.config.json'), JSON.stringify({ assets: relative(root, dir) || '.' }, null, 2) + '\n'));
  put(join(root, 'sf.actions.json'), () => copyFileSync(join(TEMPLATES, 'sf.actions.json'), join(root, 'sf.actions.json')));
  mkdirSync(join(root, '.claude', 'commands'), { recursive: true });
  put(join(root, '.claude', 'commands', 'narrate.md'), () => copyFileSync(join(TEMPLATES, 'narrate.md'), join(root, '.claude', 'commands', 'narrate.md')));

  console.log(`sprite-fighter: pasta de assets ${rel}/ (skins, poses, moves, scenes, clips)`);
  // Os clipes contam como um item só na lista.
  const clips = (l: string[]) => {
    const n = l.filter((f) => f.startsWith(join(rel, 'clips'))).length;
    return [...(n ? [`${join(rel, 'clips')}/ (${n} clipes)`] : []), ...l.filter((f) => !f.startsWith(join(rel, 'clips')))];
  };
  if (done.length) console.log(`criados:\n${clips(done).map((f) => `  ${f}`).join('\n')}`);
  if (kept.length) console.log(`já existiam (mantidos; --force sobrescreve):\n${clips(kept).map((f) => `  ${f}`).join('\n')}`);
  console.log(`
Próximos passos:
  1. escreva o manifesto do personagem em ${rel}/skins/<id>.json (veja o README: "novo personagem")
  2. npx sf pose:list --char <id>            prompts de imagem
  3. npx sf pose:add --char <id> --pose fly --src <imagem.png> --dir poses/<coleção>/<id>
  4. npx sf lab                              Pose Lab e tira de poses em http://localhost:5180
No app, o <sf-scene> lê os mesmos arquivos pela URL em que ${rel}/ é servida.`);
}

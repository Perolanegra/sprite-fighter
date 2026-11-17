// npm run pack:all: compila e empacota os 3 pacotes em dist/packs/*.tgz (teste local, sem publicar).
//   @perolanegra/sprite-fighter        packages/core
//   @perolanegra/ngx-sprite-fighter    packages/angular/dist (saída do ng-packagr)
//   @perolanegra/sprite-fighter-cli    packages/cli (dist, lab e templates)
// Confere também as regras de empacotamento: o player sem dependências, os mesmos números de versão
// e nenhum asset de personagem dentro dos pacotes.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}dist/packs`;
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

console.log('compilando…');
run('npm', ['run', 'build', '-w', 'packages/core']);
run('npm', ['run', 'build', '-w', 'packages/cli']);
run('npx', ['ng', 'build', 'ngx-sprite-fighter']);

const packages = [
  { dir: 'packages/core', manifest: 'packages/core/package.json' },
  { dir: 'packages/angular/dist', manifest: 'packages/angular/dist/package.json' },
  { dir: 'packages/cli', manifest: 'packages/cli/package.json' },
];
const manifests = packages.map((p) => JSON.parse(readFileSync(`${root}${p.manifest}`, 'utf8')));
const core = manifests[0];
if (Object.keys(core.dependencies ?? {}).length) throw new Error(`o player não pode ter dependências: ${Object.keys(core.dependencies).join(', ')}`);
const versions = new Set(manifests.map((m) => m.version));
if (versions.size !== 1) throw new Error(`versões diferentes: ${manifests.map((m) => `${m.name}@${m.version}`).join(', ')}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const p of packages) {
  const [info] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', out], `${root}${p.dir}`));
  const personagem = info.files.filter((f) => /\.(webp|png)$/.test(f.path) || /skins\/|poses\//.test(f.path));
  if (personagem.length) throw new Error(`${info.name}: assets de personagem no pacote: ${personagem.map((f) => f.path).join(', ')}`);
  console.log(`${info.name}@${info.version}  ${info.filename}  ${(info.size / 1024).toFixed(0)} KB (${info.entryCount} arquivos)`);
}
console.log(`\npacotes em dist/packs/. Num app: npm i <caminho>/dist/packs/*.tgz`);

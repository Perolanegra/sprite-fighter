import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// SF_ASSETS troca a pasta de assets (ex.: uma cópia para testar o narrador sem mexer nos manifestos).
const assetsDir = process.env['SF_ASSETS'] ?? fileURLToPath(new URL('../../assets', import.meta.url));

/** skin.json legível, como o gravado pelo CLI de poses (tools/atlas): um osso e uma corrente por linha. */
function formatSkin(skin: Record<string, unknown>): string {
  const { bones = [], chains = [], ...rest } = skin as { bones?: unknown[]; chains?: unknown[] };
  const head = Object.entries(rest).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const list = (items: unknown[]) => items.map((i) => '    ' + JSON.stringify(i)).join(',\n');
  return `{\n${head.join(',\n')},\n  "bones": [\n${list(bones)}\n  ],\n  "chains": [\n${list(chains)}\n  ]\n}\n`;
}

/**
 * Só no servidor de dev: `GET /__sf/characters` lista os personagens (manifestos em skins/), e o Pose Lab grava poses (assets/poses/<char>/<nome>.json) e esqueletos
 * de poses-imagem (assets/poses/<coleção>/<char>/<pose>.skin.json)
 * (POST /__sf/save { path, content }). Qualquer outro caminho é recusado.
 */
function saveAssets(): Plugin {
  // Poses nomeadas do rig de peças (poses/<id>/<nome>.json) e esqueletos das poses-imagem
  // (poses/<coleção>/<id>/<pose>.skin.json).
  const allowed = /^poses\/([a-z0-9_-]+\/)?[a-z0-9_-]+\/[a-z0-9_-]+(\.skin)?\.json$/;
  return {
    name: 'sf-save-assets',
    apply: 'serve',
    configureServer(server) {
      // Personagens = os manifestos em skins/; `parts` = também tem atlas e rig de peças.
      server.middlewares.use('/__sf/characters', async (_req, res) => {
        const ids = (await readdir(join(assetsDir, 'skins')).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
        const list = ids.map((id) => ({ id, parts: existsSync(join(assetsDir, 'atlas', `${id}.atlas.json`)) && existsSync(join(assetsDir, 'rigs', `${id}.rig.json`)) }));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(list));
      });
      // Ações TS do app declaradas em sf.actions.json (raiz do projeto): a prévia as troca por ações vazias.
      server.middlewares.use('/__sf/actions', async (_req, res) => {
        const file = join(process.env['INIT_CWD'] ?? process.cwd(), 'sf.actions.json');
        res.setHeader('Content-Type', 'application/json');
        res.end(existsSync(file) ? await readFile(file, 'utf8') : '[]');
      });
      server.middlewares.use('/__sf/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { path, content } = JSON.parse(body) as { path: string; content: unknown };
            if (!allowed.test(path)) throw new Error(`caminho não permitido: ${path}`);
            const file = join(assetsDir, path);
            await mkdir(dirname(file), { recursive: true });
            await writeFile(file, path.endsWith('.skin.json') ? formatSkin(content as Record<string, unknown>) : JSON.stringify(content, null, 2) + '\n');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path }));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  // Atlas, rigs e demais dados de autoria são servidos da pasta assets/ da raiz.
  publicDir: assetsDir,
  // Em dev a demo usa o código-fonte da lib direto (sem precisar do build do core).
  resolve: {
    alias: [
      { find: /^sprite-fighter$/, replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) },
      { find: /^sprite-fighter\/authoring$/, replacement: fileURLToPath(new URL('../../packages/core/src/authoring.ts', import.meta.url)) },
    ],
  },
  plugins: [saveAssets()],
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
});

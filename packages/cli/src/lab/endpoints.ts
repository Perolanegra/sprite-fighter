import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { formatSkin } from '../atlas/format.js';

/**
 * Rotas do lab (`sf lab`, e o `npm run dev` da demo no monorepo), sobre a pasta de assets do projeto:
 *  - `GET /__sf/characters`: os personagens (manifestos em skins/); `parts` = também tem atlas e rig;
 *  - `GET /__sf/scenes`: as cenas em scenes/ (para a página inicial do lab);
 *  - `GET /__sf/actions`: o `sf.actions.json` da raiz do projeto (ações do app; a prévia as troca por vazias);
 *  - `POST /__sf/save { path, content }`: o Pose Lab grava poses nomeadas (poses/<id>/<nome>.json) e
 *    esqueletos (poses/<coleção>/<id>/<pose>.skin.json). Qualquer outro caminho é recusado.
 * No formato connect (req, res, next): serve ao Vite e ao servidor do lab.
 */
export function sfEndpoints(assetsDir: string, projectRoot: string) {
  const allowed = /^poses\/([a-z0-9_-]+\/)?[a-z0-9_-]+\/[a-z0-9_-]+(\.skin)?\.json$/;
  const json = (res: ServerResponse, body: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const list = async (dir: string) => (await readdir(join(assetsDir, dir)).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const url = (req.url ?? '').split('?')[0];
    if (url === '/__sf/characters')
      return json(
        res,
        (await list('skins')).map((id) => ({ id, parts: existsSync(join(assetsDir, 'atlas', `${id}.atlas.json`)) && existsSync(join(assetsDir, 'rigs', `${id}.rig.json`)) })),
      );
    if (url === '/__sf/scenes') return json(res, (await list('scenes')).filter((n) => !n.endsWith('.narrative')));
    if (url === '/__sf/actions') {
      const file = join(projectRoot, 'sf.actions.json');
      return json(res, existsSync(file) ? await readFile(file, 'utf8') : '[]');
    }
    if (url === '/__sf/save') {
      if (req.method !== 'POST') return json(res, { ok: false, error: 'use POST' }, 405);
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const { path, content } = JSON.parse(body) as { path: string; content: unknown };
        if (!allowed.test(path)) throw new Error(`caminho não permitido: ${path}`);
        const file = join(assetsDir, path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, path.endsWith('.skin.json') ? formatSkin(content as Parameters<typeof formatSkin>[0]) : JSON.stringify(content, null, 2) + '\n');
        return json(res, { ok: true, path });
      } catch (err) {
        return json(res, { ok: false, error: (err as Error).message }, 400);
      }
    }
    next();
  };
}

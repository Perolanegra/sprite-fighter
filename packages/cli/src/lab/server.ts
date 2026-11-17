import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sfEndpoints } from './endpoints.js';

/** A demo compilada (Pose Lab, tira de poses, cenas), que vai dentro do pacote (`lab/`). */
export const LAB_DIR = fileURLToPath(new URL('../../lab/', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

/** Arquivo dentro de `base` (sem sair dela por `..`), ou null. */
async function fileIn(base: string, url: string): Promise<string | null> {
  const file = normalize(join(base, decodeURIComponent(url)));
  if (file !== base && !file.startsWith(base.endsWith(sep) ? base : base + sep)) return null;
  const s = await stat(file).catch(() => null);
  return s?.isFile() ? file : null;
}

/**
 * Servidor do lab: a demo compilada mais os assets do projeto e as rotas `/__sf/*`. Os assets são
 * servidos na raiz (`/skins/<id>.json`, `/poses/…`), como a demo espera.
 */
export async function startLab(o: { assetsDir: string; projectRoot: string; port?: number }): Promise<{ url: string; server: Server; close(): Promise<void> }> {
  if (!existsSync(join(LAB_DIR, 'index.html'))) throw new Error(`lab não encontrado em ${LAB_DIR} (no monorepo: npm run build -w packages/cli)`);
  const assets = resolve(o.assetsDir);
  const api = sfEndpoints(assets, o.projectRoot);
  const server = createServer((req, res) => {
    void api(req, res, async () => {
      const url = (req.url ?? '/').split('?')[0]!;
      const file = url === '/' ? join(LAB_DIR, 'index.html') : ((await fileIn(LAB_DIR, url)) ?? (await fileIn(assets, url)));
      if (!file) {
        res.statusCode = 404;
        return res.end(`não encontrado: ${url}`);
      }
      res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.end(await readFile(file));
    });
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(o.port ?? 5180, '127.0.0.1', () => ok());
  });
  const port = (server.address() as { port: number }).port;
  return { url: `http://localhost:${port}/`, server, close: () => new Promise((ok) => server.close(() => ok())) };
}

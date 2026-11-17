import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { sfEndpoints } from '../../packages/cli/src/lab/endpoints.ts';

// SF_ASSETS troca a pasta de assets (ex.: uma cópia para testar o narrador sem mexer nos manifestos).
const assetsDir = process.env['SF_ASSETS'] ?? fileURLToPath(new URL('../../assets', import.meta.url));
const projectRoot = process.env['INIT_CWD'] ?? process.cwd();

/** Só no servidor de dev: as rotas do lab (`/__sf/characters`, `/scenes`, `/actions`, `/save`), as mesmas do `sf lab`. */
function sfApi(): Plugin {
  return {
    name: 'sf-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(sfEndpoints(assetsDir, projectRoot));
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Dev: atlas, rigs e demais dados de autoria vêm da pasta assets/ da raiz.
  // Modo "lab" (build do CLI): sem assets; o `sf lab` serve os do projeto.
  publicDir: mode === 'lab' ? false : assetsDir,
  // Em dev a demo usa o código-fonte da lib direto (sem precisar do build do core).
  resolve: {
    alias: [
      { find: /^@perolanegra\/sprite-fighter$/, replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) },
      { find: /^@perolanegra\/sprite-fighter\/authoring$/, replacement: fileURLToPath(new URL('../../packages/core/src/authoring.ts', import.meta.url)) },
    ],
  },
  plugins: [sfApi()],
  build: mode === 'lab' ? { outDir: fileURLToPath(new URL('../../packages/cli/lab', import.meta.url)), emptyOutDir: true } : {},
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
}));

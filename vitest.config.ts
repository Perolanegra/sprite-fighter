import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Testes de lógica pura de todos os pacotes, rodados da raiz.
export default defineConfig({
  // Testes da demo usam o código-fonte do core (como o Vite da demo).
  resolve: {
    alias: [
      { find: /^sprite-fighter$/, replacement: fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)) },
      { find: /^sprite-fighter\/authoring$/, replacement: fileURLToPath(new URL('./packages/core/src/authoring.ts', import.meta.url)) },
    ],
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'tools/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});

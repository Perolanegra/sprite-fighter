// Parte do build do CLI que não é TypeScript:
//  - lab/: a demo (apps/demo) compilada sem os assets (o `sf lab` serve os assets do projeto);
//  - templates/narrate.md: o comando /narrate do repositório, copiado pelo `sf init`.
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
await build({ configFile: here('../../apps/demo/vite.config.ts'), root: here('../../apps/demo'), mode: 'lab', logLevel: 'warn' });
copyFileSync(here('../../.claude/commands/narrate.md'), here('templates/narrate.md'));
console.log('lab e templates prontos');

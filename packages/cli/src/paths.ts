import { relative, resolve } from 'node:path';

/**
 * Onde o CLI trabalha. A raiz do projeto é a pasta de onde o comando foi chamado (npm/npx guardam em
 * INIT_CWD). A pasta de assets é, nesta ordem: `--assets <pasta>`, a variável `SF_ASSETS`, o campo
 * `assets` do `sf.config.json` da raiz, ou `assets/` (o `sf` resolve as três primeiras em SF_ASSETS).
 */
export const projectRoot = () => process.env['INIT_CWD'] ?? process.cwd();

export const assetsDir = (root = projectRoot()) => resolve(root, process.env['SF_ASSETS'] ?? 'assets');

/** A pasta de assets como o usuário a escreve (relativa à raiz), para as mensagens. */
export const assetsRel = (root = projectRoot()) => relative(root, assetsDir(root)) || '.';

/** Um caminho dentro dos assets, para as mensagens e os comandos impressos. */
export const inAssets = (p: string) => `${assetsRel()}/${p}`;

/** Como chamar o CLI nos comandos que ele imprime. */
export const SF = 'npx sf';

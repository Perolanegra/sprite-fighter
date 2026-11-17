import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseScript } from '@perolanegra/sprite-fighter';
import { chaseScript } from './chase-api';

describe('perseguição: API fluente ≡ JSON', () => {
  it('a versão em TS gera o mesmo roteiro de assets/scenes/chase.json', () => {
    const json = JSON.parse(readFileSync(new URL('../../../assets/scenes/chase.json', import.meta.url), 'utf8'));
    expect(chaseScript().build()).toEqual(parseScript(json));
  });
});

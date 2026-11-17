import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Genericidade: o core não conhece nenhum personagem. Nenhum id, nome ou pasta de personagem dos
 * manifestos (assets/skins/*.json) pode aparecer no código do core, nem em comentários.
 */
const root = join(import.meta.dirname, '../../..');
const skinsDir = join(root, 'assets/skins');

function characterWords(): string[] {
  const words = new Set<string>(['vilain']); // nome antigo da pasta do smith
  for (const f of readdirSync(skinsDir).filter((f) => f.endsWith('.json'))) {
    const id = f.replace(/\.json$/, '');
    words.add(id);
    const m = JSON.parse(readFileSync(join(skinsDir, f), 'utf8')) as { dir?: string; character?: { name?: string } };
    if (m.character?.name) words.add(m.character.name.toLowerCase());
    if (m.dir) words.add(m.dir.split('/').pop()!.toLowerCase());
  }
  return [...words];
}

describe('genericidade do core', () => {
  it('nenhum nome de personagem no código do core', () => {
    const words = characterWords();
    expect(words.length).toBeGreaterThan(1);
    const src = join(root, 'packages/core/src');
    const hits: string[] = [];
    for (const f of readdirSync(src).filter((f) => f.endsWith('.ts') && f !== 'generic.test.ts')) {
      readFileSync(join(src, f), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const w of words) if (new RegExp(`\\b${w}\\b`, 'i').test(line)) hits.push(`${f}:${i + 1}: "${w}" → ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });
});

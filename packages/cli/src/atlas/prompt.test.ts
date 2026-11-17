import { describe, expect, it } from 'vitest';
import { parseManifest } from '@perolanegra/sprite-fighter';
import { imagePrompt, variantPrompt } from './prompt.js';

const m = parseManifest(
  {
    default: 'fly',
    dir: 'poses/col/hero',
    character: { name: 'Hero', description: 'homem de capa vermelha', style: 'anime, contorno fino', styleRefs: ['poses/col/hero/src/fly.png'] },
    poses: [{ name: 'fly', description: 'voando', tags: ['voo'] }],
    provisional: { dodge: { from: 'fly', description: 'desvia para cima', tags: ['esquiva'] }, blank: { from: 'fly' } },
  },
  'hero',
);

describe('prompt de imagem', () => {
  it('monta a partir do manifesto: personagem, pose, estilo, regras, referências e comandos', () => {
    const p = imagePrompt(m, 'dodge');
    expect(p.prompt).toContain('Personagem: Hero, homem de capa vermelha.');
    expect(p.prompt).toContain('Pose: desvia para cima.');
    expect(p.prompt).toContain('Estilo: anime, contorno fino.');
    expect(p.prompt).toMatch(/fundo branco liso/);
    expect(p.prompt).toMatch(/de perfil virado para a direita/);
    expect(p.attach).toEqual(['poses/col/hero/src/fly.png']); // a pose de partida já é referência: não repete
    expect(p.next[1]).toBe('npx sf pose:add --char hero --pose dodge --src assets/poses/col/hero/src/dodge.png --description "desvia para cima" --tags "esquiva"');
    expect(imagePrompt(m, 'dodge')).toEqual(p); // determinístico
  });

  it('sem descrição: erro claro', () => {
    expect(() => imagePrompt(m, 'blank')).toThrow(/sem descrição/);
  });

  it('sem a imagem-fonte da pose (src/*.png), usa a .webp dela como referência, sem repetir', () => {
    const noSources = (rel: string) => !rel.includes('/src/');
    // styleRefs aponta para src/fly.png e a pose de partida da provisória também é fly: uma referência só.
    expect(imagePrompt(m, 'dodge', undefined, undefined, noSources).attach).toEqual(['poses/col/hero/fly.webp']);
    // Com a fonte presente, continua sendo a fonte.
    expect(imagePrompt(m, 'dodge', undefined, undefined, () => true).attach).toEqual(['poses/col/hero/src/fly.png']);
  });

  it('variante: sem a fonte da pose, a imagem a editar é a .webp (e o "mesmo tamanho" é o dela)', () => {
    const v = variantPrompt(m, 'fly', 'angry', 'expression', 'bravo', [], (rel) => !rel.includes('/src/'));
    expect(v.attach).toEqual(['poses/col/hero/fly.webp']);
    expect(v.next[0]).toMatch(/mesmo tamanho de assets\/poses\/col\/hero\/fly\.webp/);
  });
});

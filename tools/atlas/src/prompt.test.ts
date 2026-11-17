import { describe, expect, it } from 'vitest';
import { parseManifest } from 'sprite-fighter';
import { imagePrompt } from './prompt.js';

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
    expect(p.next[1]).toBe('npm run pose:add -- --char hero --pose dodge --src assets/poses/col/hero/src/dodge.png --description "desvia para cima" --tags "esquiva"');
    expect(imagePrompt(m, 'dodge')).toEqual(p); // determinístico
  });

  it('sem descrição: erro claro', () => {
    expect(() => imagePrompt(m, 'blank')).toThrow(/sem descrição/);
  });
});

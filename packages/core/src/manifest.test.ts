import { describe, expect, it } from 'vitest';
import { parseManifest } from './manifest.js';

const novo = {
  default: 'fly',
  dir: 'poses/col/hero',
  character: { name: 'Hero', description: 'homem de capa', style: 'anime', styleRefs: ['poses/col/hero/src/fly.png'] },
  poses: [
    { name: 'fly', description: 'voando', tags: ['voo', 'base'] },
    { name: 'punch', description: 'soco', tags: ['soco'] },
  ],
  provisional: { dodge: { from: 'fly', rotate: -20, description: 'desvia', tags: ['esquiva'] } },
};

describe('manifesto do personagem', () => {
  it('lê o formato novo: personagem, descrição e tags, provisórias', () => {
    const m = parseManifest(novo, 'hero');
    expect(m.character?.styleRefs).toEqual(['poses/col/hero/src/fly.png']);
    expect(m.poses.map((p) => p.name)).toEqual(['fly', 'punch']);
    expect(m.poses[1]).toEqual({ name: 'punch', description: 'soco', tags: ['soco'], variants: [] });
    expect(m.provisional['dodge']).toMatchObject({ from: 'fly', rotate: -20, sx: 1, description: 'desvia', tags: ['esquiva'] });
  });

  it('aceita o formato antigo (lista de nomes, sem character)', () => {
    const m = parseManifest({ default: 'fly', dir: 'poses/col/hero', poses: ['fly', 'kick'] }, 'hero');
    expect(m.poses[1]).toEqual({ name: 'kick', description: '', tags: [], variants: [] });
    expect(m.character).toBeNull();
  });

  it('erros claros: pasta ≠ id, pose repetida, provisória que já tem imagem, tag maiúscula', () => {
    expect(() => parseManifest({ ...novo, dir: 'poses/col/vilao' }, 'hero')).toThrow(/precisa se chamar "hero"/);
    expect(() => parseManifest({ ...novo, poses: [...novo.poses, { name: 'fly' }] }, 'hero')).toThrow(/"fly" repetida/);
    expect(() => parseManifest({ ...novo, provisional: { punch: { from: 'fly' } } }, 'hero')).toThrow(/já tem imagem/);
    expect(() => parseManifest({ ...novo, provisional: { x: { from: 'nada' } } }, 'hero')).toThrow(/provisional\.x\.from/);
    expect(() => parseManifest({ ...novo, poses: [{ name: 'fly', tags: ['Voo'] }] }, 'hero')).toThrow(/minúscula/);
  });

  it('variantes por pose: tipo, descrição e tags; nomes reservados e repetidos', () => {
    const withVariants = (variants: unknown[]) => ({ ...novo, poses: [{ name: 'fly', variants }, { name: 'punch' }] });
    const m = parseManifest(withVariants([{ name: 'angry', kind: 'expression', description: 'bravo', tags: ['raiva'] }]), 'hero');
    expect(m.poses[0]!.variants).toEqual([{ name: 'angry', kind: 'expression', description: 'bravo', tags: ['raiva'] }]);
    expect(() => parseManifest(withVariants([{ name: 'x', kind: 'mood' }]), 'hero')).toThrow(/variants\[0\]\.kind: esperado um de: expression, hand/);
    expect(() => parseManifest(withVariants([{ name: '2x', kind: 'hand' }]), 'hero')).toThrow(/nome de variante inválido "2x"/);
    expect(() => parseManifest(withVariants([{ name: 'none', kind: 'hand' }]), 'hero')).toThrow(/inválido "none"/);
    expect(() => parseManifest(withVariants([{ name: 'a', kind: 'hand' }, { name: 'a', kind: 'expression' }]), 'hero')).toThrow(/variante "a" repetida em "fly"/);
  });
});

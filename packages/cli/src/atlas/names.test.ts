import { describe, expect, it } from 'vitest';
import { isOverlayName, isValidPartName, validateNames } from './names.js';

describe('nomes de peças', () => {
  it('segue a convenção do CLAUDE.md', () => {
    for (const ok of ['head_shout', 'eyes_closed', 'hand_fist_1', 'forearm_gun', 'torso', 'ear_2', 'coat_tail_3', 'shoe_1', 'tie_knot'])
      expect(isValidPartName(ok), ok).toBe(true);
    for (const bad of ['part_3', 'Head_shout', 'coat_tail', 'shoe', 'head_', 'arm_1']) expect(isValidPartName(bad), bad).toBe(false);
  });

  it('olhos e bocas são overlay', () => {
    expect(isOverlayName('eyes_open')).toBe(true);
    expect(isOverlayName('head_open')).toBe(false);
  });

  it('aponta nomes faltando, inválidos, repetidos e chaves sobrando', () => {
    const errors = validateNames({ '1': 'torso', '2': 'torso', '3': 'part_3', '9': 'shoe_1' }, 4);
    expect(errors).toEqual([
      'peça 2: "torso" repetido (já usado na peça 1)',
      'peça 3: "part_3" fora da convenção',
      'peça 4: sem nome',
      'chave "9" não corresponde a nenhuma peça (1..4)',
    ]);
  });
});

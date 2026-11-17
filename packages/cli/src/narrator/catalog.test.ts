import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from './catalog.js';

/** assets/ de exemplo: um personagem com pose, variante e provisória, um golpe e um clipe. */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sf-catalog-'));
  const put = (f: string, v: unknown) => {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), JSON.stringify(v));
  };
  put('skins/hero.json', {
    default: 'fly',
    dir: 'poses/col/hero',
    character: { name: 'Hero', description: 'herói' },
    poses: [
      { name: 'fly', description: 'voando', tags: ['voo'], variants: [{ name: 'angry', kind: 'expression', description: 'bravo', tags: ['raiva'] }] },
      { name: 'punch', description: 'soco', tags: ['soco'] },
    ],
    provisional: { dodge: { from: 'fly', rotate: -20, description: 'desvia', tags: ['esquiva'] } },
  });
  put('moves/hero.moves.json', [{ id: 'jab', poses: ['punch'], phases: [{ name: 'a', frames: 6, pose: 'punch' }, { name: 'b', frames: 6, hitboxes: [{ bone: 'hand_front', radius: 20 }] }], onHit: { targetPose: 'punch' } }]);
  put('clips/index.json', ['idle']);
  put('clips/idle.json', { id: 'idle', frames: 30, loop: true, bones: {} });
  return dir;
}

describe('catálogo do narrador', () => {
  it('poses, variantes, provisórias, golpes e clipes vêm dos dados; saída estável', () => {
    const dir = fixture();
    const c = buildCatalog(dir);
    const hero = c.characters['hero']!;
    expect(hero.poses['fly']!.variants).toEqual({ angry: { description: 'bravo', kind: 'expression', tags: ['raiva'] } });
    expect(hero.poses['punch']!.variants).toEqual({});
    expect(hero.provisional['dodge']).toEqual({ description: 'desvia', from: 'fly', provisional: true, tags: ['esquiva'] });
    expect(hero.moves['jab']).toEqual({ attacks: 'hitbox', poses: ['punch'], seconds: 0.2, targetPose: 'punch' });
    expect(c.clips['idle']).toEqual({ loop: true, seconds: 0.5 });
    expect(c.commands['expression']!.params).toEqual(['name']);
    expect(c.props['door']!.actions).toContain('close');
    expect(JSON.stringify(buildCatalog(dir))).toBe(JSON.stringify(c));
    expect(Object.keys(c)).toEqual([...Object.keys(c)].sort());
  });
});

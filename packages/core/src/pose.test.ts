import { describe, expect, it } from 'vitest';
import { Animator } from './animator.js';
import { parseClip } from './clip.js';
import { SIM_DT } from './loop.js';
import { deg2rad } from './math.js';
import { parsePose } from './pose.js';
import { testCharacter } from './testing.js';

const rig = testCharacter().rig;
const freshPose = () => rig.bones.map(() => ({ rotation: 0, offset: { x: 0, y: 0 }, scale: 1, slot: null as string | null }));

describe('pose nomeada', () => {
  it('lê o formato do "Exportar pose" (graus → rad)', () => {
    const pose = parsePose({ name: 'fly_rest', char: 'test', bones: { torso: { rotate: 90 } } }, rig);
    expect(pose.name).toBe('fly_rest');
    expect(pose.bones.get('torso')!.rot).toBeCloseTo(Math.PI / 2);
  });

  it('erros claros: osso ou slot que o rig não tem', () => {
    expect(() => parsePose({ bones: { tail: { rotate: 1 } } }, rig)).toThrow(/osso "tail" não existe/);
    expect(() => parsePose({ bones: { torso: { slot: 'head_x' } } }, rig)).toThrow(/não é slot/);
  });

  it('o clipe com "pose" soma a base por baixo das chaves', () => {
    const an = new Animator(rig);
    an.poses.set('fly_rest', parsePose({ name: 'fly_rest', bones: { arm_front_upper: { rotate: 30 }, torso: { rotate: -10 } } }, rig));
    an.play(parseClip({ id: 'idle', loop: true, frames: 10, pose: 'fly_rest', bones: { arm_front_upper: [{ f: 0, rot: 5 }] } }));
    an.advance(SIM_DT);
    const pose = freshPose();
    an.apply(pose);
    expect(pose[rig.byName.get('arm_front_upper')!]!.rotation).toBeCloseTo(deg2rad(35));
    expect(pose[rig.byName.get('torso')!]!.rotation).toBeCloseTo(deg2rad(-10));
  });

  it('clipe sem "pose" não é afetado; pose não carregada é erro ao tocar', () => {
    const an = new Animator(rig);
    an.poses.set('fly_rest', parsePose({ bones: { torso: { rotate: -10 } } }, rig));
    an.play(parseClip({ id: 'other', frames: 10, bones: { arm_front_upper: [{ f: 0, rot: 5 }] } }));
    an.advance(SIM_DT);
    const pose = freshPose();
    an.apply(pose);
    expect(pose[rig.byName.get('torso')!]!.rotation).toBe(0);
    expect(() => new Animator(rig).play(parseClip({ id: 'x', frames: 5, pose: 'nope' }))).toThrow(/pose "nope" não carregada/);
  });
});

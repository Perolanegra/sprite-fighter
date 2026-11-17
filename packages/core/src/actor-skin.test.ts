import { describe, expect, it } from 'vitest';
import { Actor, TRANSITION_FRAMES } from './actor.js';
import type { AtlasImage } from './character.js';
import { buildImagePose } from './image-pose.js';
import { SIM_DT } from './loop.js';
import { SKIN_BODY } from './skin.js';
import { testCharacter } from './testing.js';

/** Personagem de teste com uma pose-imagem "fly" (imagem 200×80 cheia). */
function withImagePose() {
  const char = testCharacter();
  const w = 200, h = 80;
  const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  const bones = SKIN_BODY.map(([name, parent], i) => ({ name, parent, head: [20 + i * 10, 40], tail: [30 + i * 10, 40] }));
  // Raiz e tronco ao longo da figura; "arm_front_upper" existe nos dois rigs (copia rotação por nome).
  const pose = buildImagePose({ char: 'test', pose: 'fly', image: 'x.png', bones }, { width: w, height: h } as AtlasImage, rgba);
  char.addImagePose(pose);
  return char;
}

describe('setSkin / setPose', () => {
  it('troca a skin de todos os actors, preservando posição, velocidade e rotações por nome', () => {
    const char = withImagePose();
    const actor = new Actor(char, { hover: false, cloth: false, squash: false });
    expect(actor.skinKey).toBe('parts');
    actor.position = { x: 120, y: -40 };
    actor.velocity = { x: 300, y: 0 };
    actor.step(SIM_DT);
    actor.sim.pose[actor.sim.bone('arm_front_upper')]!.rotation = 0.1;
    char.setSkin('image', { transition: 'afterimage' });
    expect(actor.skinKey).toBe('image:fly');
    expect(actor.sim.rig.kind).toBe('image');
    expect(actor.velocity).toEqual({ x: 300, y: 0 });
    expect(actor.sim.pose[actor.sim.bone('arm_front_upper')]!.rotation).toBeCloseTo(0.1);
    expect(actor.transition?.kind).toBe('afterimage');
  });

  it('a transição dura N frames de 60 fps e some; "cut" não deixa rastro', () => {
    const char = withImagePose();
    const actor = new Actor(char, { hover: false, cloth: false, squash: false });
    char.setPose('fly', { transition: 'flash' });
    expect(actor.transition?.kind).toBe('flash');
    const steps = Math.ceil(((TRANSITION_FRAMES.flash + 1) / 60) / SIM_DT);
    for (let i = 0; i < steps; i++) actor.step(SIM_DT);
    expect(actor.transition).toBeNull();
    char.setSkin('parts', { transition: 'cut' });
    expect(actor.skinKey).toBe('parts');
    expect(actor.transition).toBeNull();
  });

  it('na pose-imagem a rotação fica no limite (±12° por padrão)', () => {
    const char = withImagePose();
    const actor = new Actor(char, { hover: false, cloth: false, squash: false });
    char.setSkin('image', { transition: 'cut' });
    actor.reach.clear();
    actor.step(SIM_DT);
    actor.lookTarget = { x: 0, y: -100000 }; // pede um giro grande da cabeça
    actor.lookLimit = Math.PI;
    actor.step(SIM_DT);
    // O limite é guardado em Float32: tolerância de 1e-6.
    expect(Math.abs(actor.sim.pose[actor.sim.bone("head")]!.rotation)).toBeLessThanOrEqual((12 * Math.PI) / 180 + 1e-6);
  });

  it('pose nova com ossos diferentes é recusada', () => {
    const char = withImagePose();
    const w = 100, h = 50;
    const bones = SKIN_BODY.map(([name, parent], i) => ({ name, parent, head: [5 + i * 5, 20], tail: [9 + i * 5, 20] }));
    bones.push({ name: 'extra', parent: 'hips', head: [5, 30], tail: [20, 30] });
    const other = buildImagePose({ char: 'test', pose: 'dash', image: 'y.png', bones }, { width: w, height: h } as AtlasImage, new Uint8ClampedArray(w * h * 4).fill(255));
    expect(() => char.addImagePose(other)).toThrow(/os ossos precisam ser os mesmos/);
  });
});

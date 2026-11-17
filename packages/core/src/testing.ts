import { PartGeometry } from './geometry.js';

/** Geometria de um retângulo cheio (w × h) girado em `angle` rad em volta do centro (cx, cy). */
export function rectGeometry(w: number, h: number, angle = 0, cx = w / 2, cy = h / 2): PartGeometry {
  const pts: number[] = [];
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - w / 2, dy = y + 0.5 - h / 2;
      pts.push(cx + dx * c - dy * s, cy + dx * s + dy * c);
    }
  return new PartGeometry(Float32Array.from(pts));
}

import { Character, type AtlasImage } from './character.js';
import { buildImagePose, provisionalPose } from './image-pose.js';
import { SKIN_BODY } from './skin.js';

/** Personagem de teste: tronco, braço (2 ossos) e uma "aba" com mola, sem imagem de verdade. */
export function testCharacter(): Character {
  const parts = [
    { name: 'torso', w: 40, h: 100 },
    { name: 'upper_arm_1', w: 20, h: 60 },
    { name: 'forearm_bare_1', w: 20, h: 60 },
    { name: 'coat_tail_1', w: 80, h: 20 },
  ];
  const atlas = {
    char: 'test',
    image: 'test.png',
    width: 256,
    height: 256,
    parts: parts.map((p) => ({ ...p, kind: 'part', x: 0, y: 0, sourceRect: { x: 0, y: 0, w: p.w, h: p.h } })),
  };
  const rig = {
    char: 'test',
    bones: [
      { name: 'torso', part: 'torso', parent: null, pivot: { bbox: [0.5, 0.5] }, rotate: 0 },
      { name: 'arm_front_upper', part: 'upper_arm_1', parent: 'torso', pivot: 'top', attach: { bbox: [0.5, 0.1] }, angle: 0 },
      { name: 'arm_front_fore', part: 'forearm_bare_1', parent: 'arm_front_upper', pivot: 'top', attach: 'end', angle: 0 },
      { name: 'coat_tail_1', part: 'coat_tail_1', parent: 'torso', pivot: 'left', attach: { bbox: [0.5, 0.9] }, angle: 180, layer: 'back' },
    ],
    chains: [{ name: 'tail', bones: ['coat_tail_1'], stiffness: 0.3, damping: 0.2 }],
  };
  const full = (p: { w: number; h: number }) => new Uint8ClampedArray(p.w * p.h).fill(255);
  return Character.fromData(atlas, rig, { width: 256, height: 256 } as AtlasImage, (p) => full(p));
}

/** Personagem com poses-imagem fly/punch/hurt (imagem 200×80 cheia) e a "dodge" provisória. */
export function fighterCharacter(): Character {
  const char = testCharacter();
  char.poseIndex = { default: 'fly', dir: '', poses: ['fly', 'punch', 'hurt'], provisional: {} };
  const w = 200, h = 80;
  const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [pose, dy] of [['fly', 0], ['punch', 6], ['hurt', -6]] as const) {
    // Mesmo esqueleto, deslocado na imagem: o quadril (raiz) é a âncora entre as poses.
    const bones = SKIN_BODY.map(([name, parent], i) => ({ name, parent, head: [20 + i * 10, 40 + dy], tail: [30 + i * 10, 40 + dy] }));
    char.addImagePose(buildImagePose({ char: 'test', pose, image: 'x.png', bones }, { width: w, height: h } as AtlasImage, rgba));
  }
  const variation = { from: 'fly', rotate: 90, sx: 1, sy: 1, dx: 0, dy: 0 };
  char.poseIndex.provisional['dodge'] = variation;
  char.addImagePose(provisionalPose('dodge', char.imagePoses.get('fly')!, variation));
  char.setPose('fly', { transition: 'cut' });
  return char;
}

import { deg2rad } from './math.js';
import type { SolvedRig } from './rig.js';
import { Reader } from './validate.js';

/**
 * Pose nomeada (`poses/<char>/<nome>.json`): ajustes por osso somados ao repouso do rig, no mesmo
 * formato do "Exportar pose" do Pose Lab. Um clipe pode usá-la como base ("pose": "fly_rest").
 *
 *   { "name": "fly_rest", "char": "<id>", "bones": { "head": { "rotate": -6 }, "hand_back": { "slot": "hand_fist_2" } } }
 */
export interface PoseBone {
  /** Rotação extra em rad (no JSON, graus em "rotate"). */
  rot: number;
  x: number;
  y: number;
  scale: number;
  /** Peça do slot (null = escondido); undefined = não mexe. */
  slot?: string | null;
}

export interface PoseData {
  name: string;
  char: string;
  bones: Map<string, PoseBone>;
}

export function parsePose(json: unknown, rig?: SolvedRig, source = 'pose'): PoseData {
  const r = new Reader(source, json);
  r.object();
  const bones = new Map<string, PoseBone>();
  const bonesR = r.at('bones');
  if (bonesR.present)
    for (const name of Object.keys(bonesR.object())) {
      const b = bonesR.at(name);
      b.object();
      const index = rig?.byName.get(name);
      if (rig && index === undefined) b.fail(`osso "${name}" não existe no rig ${rig.char}`);
      const entry: PoseBone = {
        rot: deg2rad(b.at('rotate').optNumber(0)),
        x: b.at('x').optNumber(0),
        y: b.at('y').optNumber(0),
        scale: b.at('scale').optNumber(1),
      };
      if ('slot' in b.object()) {
        const slot = b.at('slot').value;
        if (slot !== null && typeof slot !== 'string') b.at('slot').fail('esperado o nome da peça ou null');
        if (rig && slot !== null && !rig.bones[index!]!.slots.includes(slot as string))
          b.at('slot').fail(`"${slot}" não é slot do osso (slots: ${rig.bones[index!]!.slots.join(', ') || 'nenhum'})`);
        entry.slot = slot as string | null;
      }
      bones.set(name, entry);
    }
  return { name: r.at('name').optString() ?? 'pose', char: r.at('char').optString() ?? rig?.char ?? '', bones };
}

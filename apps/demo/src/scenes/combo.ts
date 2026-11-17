import { Actor, Hover, World, type Character, type ClipData } from '@perolanegra/sprite-fighter';
import { loadCharacter } from '../assets';
import { loadClips } from '../clips';
import { cityLayers } from '../backdrop';
import { loadMoves, runFight } from '../fight';

/**
 * ?scene=combo — o agente (smith) faz jab → jab2 → heavy_punch no neo, que flutua parado.
 * Cada golpe começa quando o anterior termina; o neo reage sozinho a cada contato (onHit) e é
 * lançado no último. `&at=hit:3` para no 3º contato (ver fight.ts).
 * Outros golpes: `&combo=kick,dash_strike` e `&attacker=neo` (ex.: `&combo=energy_blast`).
 */
const COMBO = ['jab', 'jab2', 'heavy_punch'];
const SCALE = 0.5;

export async function comboScene(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const clips = await loadClips();
  const combo = params.get('combo')?.split(',') ?? COMBO;
  const attacker = params.get('attacker') === 'neo' ? 'neo' : 'smith';
  const target = attacker === 'neo' ? 'smith' : 'neo';
  let actors: Actor[] = [];
  await runFight(canvas, params, async () => {
    for (const a of actors) a.dispose();
    const [neoChar, smithChar] = await Promise.all([loadCharacter('neo'), loadCharacter('smith')]);
    const [neoMoves, smithMoves] = await Promise.all([loadMoves('neo'), loadMoves('smith')]);
    const world = new World({ clips, seed: 7 });
    const neo = fighterActor(neoChar, clips);
    const smith = fighterActor(smithChar, clips);
    actors = [neo, smith];
    const [atk, tgt] = attacker === 'smith' ? [smith, neo] : [neo, smith];
    atk.position = { x: 0, y: 0 };
    atk.facing = 1;
    tgt.position = { x: Number(params.get('gap') ?? 600), y: 10 };
    tgt.facing = -1;
    world.add('smith', smith, smithMoves);
    world.add('neo', neo, neoMoves);
    await world.prepare();
    world.setMotion('neo', new Hover());
    world.setMotion('smith', new Hover());

    let next = 0;
    let started = false;
    world.on('moveEnd', (e: { fighter: string }) => {
      if (e.fighter === attacker && next < combo.length) world.perform(attacker, combo[next++]!, target);
    });
    // Câmera automática nos dois; o golpe final entra em câmera lenta (trecho do roteiro).
    const cam = world.camera;
    cam.setAuto({ maxZoom: Number(params.get('zoom') ?? 0.62), minZoom: 0.25, margin: 100 });
    cam.snap();
    const slow = params.get('slow') !== '0';
    world.on('phase', (e: { move?: string; phase: string }) => {
      if (slow && e.move === 'heavy_punch' && e.phase === 'ativo') world.slowMotion(0.3, 0.9, 0.06);
    });
    const layers = cityLayers(0);
    return {
      world,
      title: `combo: ${attacker} ${combo.join(' → ')} no ${target}`,
      order: [target, attacker],
      script: (t) => {
        if (!started && t >= 0.3) {
          started = true;
          world.perform(attacker, combo[next++]!, target);
        }
      },
      parallax: layers,
    };
  });
}

/** Actor em pose-imagem, no voo, tocando o idle_fly. */
export function fighterActor(char: Character, clips: Map<string, ClipData>, scale = SCALE): Actor {
  char.setPose(char.basePose ?? 'fly', { transition: 'cut' });
  const a = new Actor(char, { scale });
  a.play(clips.get('idle_fly')!);
  return a;
}

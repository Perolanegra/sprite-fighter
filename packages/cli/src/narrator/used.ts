import { eachStep, type MoveData, type Script } from '@perolanegra/sprite-fighter';

/**
 * Poses que a cena usa, por ator: a inicial do elenco, os passos `pose` e as fases dos golpes
 * (`move`), inclusive a pose de reação (`targetPose`) no alvo do golpe.
 */
export function posesUsed(script: Script, movesOf: (actor: string) => Map<string, MoveData> | undefined): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const add = (char: string | null | undefined, pose: unknown) => typeof pose === 'string' && char && (used.get(char) ?? used.set(char, new Set()).get(char)!).add(pose);
  for (const [id, c] of script.cast) add(id, c.pose);
  eachStep(script.steps, (s) => {
    if (s.do === 'pose') add(s.actor, s.params['name']);
    if (s.do !== 'move' || !s.actor) return;
    const m = movesOf(s.actor)?.get(s.params['id'] as string);
    if (!m) return;
    for (const p of m.poses) add(s.actor, p);
    for (const ph of m.phases) add(s.actor, ph.pose);
    const target = s.params['target'] as string | undefined;
    const reactions = [m.onHit?.targetPose, ...m.phases.map((ph) => ph.spawn?.onHit?.targetPose)];
    if (target) for (const r of reactions) add(target, r ?? undefined);
  });
  return used;
}

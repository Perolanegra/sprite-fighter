import { parsePose, type Character, type ClipData, type PoseData } from '@perolanegra/sprite-fighter';

/** Carrega a pose nomeada de um personagem (assets/poses/<char>/<nome>.json). */
export async function loadPose(char: Character, name: string): Promise<PoseData> {
  const res = await fetch(`/poses/${char.name}/${name}.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`pose "${name}" de ${char.name} não encontrada (assets/poses/${char.name}/${name}.json)`);
  return parsePose(await res.json(), char.rig, `pose ${char.name}/${name}`);
}

/** Todas as poses usadas como base pelos clipes. */
export async function loadClipPoses(char: Character, clips: Iterable<ClipData>): Promise<Map<string, PoseData>> {
  const names = new Set([...clips].map((c) => c.pose).filter((p): p is string => !!p));
  const poses = await Promise.all([...names].map((n) => loadPose(char, n)));
  return new Map(poses.map((p) => [p.name, p]));
}

/** Grava a pose pelo servidor de dev (Pose Lab). */
export async function savePose(charName: string, name: string, content: unknown): Promise<void> {
  const res = await fetch('/__sf/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: `poses/${charName}/${name}.json`, content }),
  });
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !out.ok) throw new Error(out.error ?? `falha ao salvar (${res.status}); o salvamento só funciona no npm run dev`);
}

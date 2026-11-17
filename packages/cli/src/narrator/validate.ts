import { DataError, Director, SIM_DT, parseScript, type CastMember, type ClipData, type Script } from '@perolanegra/sprite-fighter';
import { checkScene } from '@perolanegra/sprite-fighter/authoring';
import { checkActions, type DeclaredAction } from './actions.js';
import { loadCast } from './assets.js';
import type { Narrative } from './narrative.js';
import { posesUsed } from './used.js';

export interface Validation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Duração (s): a do roteiro ou a medida. */
  duration: number | null;
  /** Eventos que aconteceram na simulação. */
  events: Record<string, number>;
  /** Poses que a cena usa e que ainda não têm imagem (provisórias), por ator. */
  provisional: { char: string; pose: string; from: string }[];
  /** Poses que a cena usa e que ainda não existem nem como provisórias (rode `missing`). */
  pending: { char: string; pose: string }[];
}

const OUT_OF_FRAME = 0.5;
const ENDLESS = 119;

type Cast = { characters: Map<string, CastMember>; clips: Map<string, ClipData> };

/**
 * Valida uma cena no motor, sem navegador e sem IA:
 *  1. formato (`parseScript`) e coerência com o arquivo lateral (poseMap, missing);
 *  2. nomes contra os personagens (`checkScene`: poses, golpes, clipes, efeitos, props) e as ações
 *     TS dos golpes contra as embutidas e as de `sf.actions.json`;
 *  3. simulação seca até o fim: duração, passo `on` que nunca dispara, evento esperado que não
 *     acontece, cena sem fim, ator visível fora do quadro; avisos do diretor (variante que falta).
 */
export async function validateScene(
  scene: unknown,
  o: { assetsDir?: string; cast?: Cast; narrative?: Narrative | null; /** `sf.actions.json` (null = sem o arquivo). */ actions?: DeclaredAction[] | null } = {},
): Promise<Validation> {
  const errors: string[] = [], warnings: string[] = [];
  const v: Validation = { ok: false, errors, warnings, duration: null, events: {}, provisional: [], pending: [] };
  const msg = (e: unknown) => (e instanceof DataError || e instanceof Error ? e.message : String(e));
  let script: Script;
  try {
    script = parseScript(scene, 'cena');
  } catch (e) {
    errors.push(msg(e));
    return v;
  }
  const cast = o.cast ?? (await loadCast(o.assetsDir!, [...script.cast.keys()]));
  const n = o.narrative;

  // Poses citadas: com imagem, provisórias ou inexistentes.
  const used = posesUsed(script, (id) => cast.characters.get(id)?.moves);
  for (const [char, poses] of used) {
    const ch = cast.characters.get(char)?.character;
    if (!ch) continue;
    for (const pose of poses) {
      const prov = ch.poseIndex?.provisional[pose];
      if (prov) v.provisional.push({ char, pose, from: prov.from });
      else if (!ch.availablePoses().has(pose)) v.pending.push({ char, pose });
    }
  }
  for (const p of v.pending) {
    const declared = n?.missing.some((m) => m.kind === 'pose' && m.char === p.char && m.name === p.pose);
    errors.push(
      declared
        ? `pose "${p.pose}" de "${p.char}" ainda não existe: rode \`npx sf missing <cena>\` para criá-la como provisória`
        : `pose "${p.pose}" de "${p.char}" não existe nem está em "missing" do arquivo lateral (use uma pose do catálogo ou declare a que falta)`,
    );
  }

  // Coerência do arquivo lateral.
  if (n) {
    for (const p of n.poseMap) {
      if (!script.cast.has(p.char)) errors.push(`poseMap "${p.action}": "${p.char}" não está no elenco da cena`);
      if (p.match === 'missing' && !n.missing.some((m) => m.char === p.char && (m.kind === 'pose' ? m.name === p.pose : m.kind === 'variant' && m.name === p.pose)))
        errors.push(`poseMap "${p.action}": match "missing" para "${p.pose}", mas ela não está em "missing"`);
      // Provisória aparece como tal (com a pose de onde vem a imagem), nunca como exact/similar.
      const prov = cast.characters.get(p.char)?.character.poseIndex?.provisional[p.pose];
      if (prov && p.match !== 'provisional')
        errors.push(`poseMap "${p.action}": "${p.pose}" de "${p.char}" é provisória (imagem de "${prov.from}"): use match "provisional" com from "${prov.from}", não "${p.match}"`);
      if (p.match === 'provisional' && !prov) errors.push(`poseMap "${p.action}": match "provisional", mas "${p.pose}" de "${p.char}" não é provisória`);
      if (p.match === 'provisional' && prov && p.from !== prov.from) errors.push(`poseMap "${p.action}": "${p.pose}" é provisória a partir de "${prov.from}", não de "${p.from}"`);
    }
    for (const m of n.missing) {
      const ch = cast.characters.get(m.char)?.character;
      if (!ch) {
        errors.push(`missing "${m.name}": "${m.char}" não está no elenco da cena`);
        continue;
      }
      if (m.kind === 'pose' && !ch.availablePoses().has(m.closest)) errors.push(`missing "${m.name}": closest "${m.closest}" não é pose de "${m.char}"`);
      if (m.kind === 'variant' && !(ch.poseIndex?.poses ?? []).includes(m.pose)) errors.push(`missing "${m.name}": variante de "${m.pose}", que não é pose com imagem de "${m.char}"`);
    }
  } else warnings.push('sem arquivo lateral (<cena>.narrative.json): normal numa cena escrita à mão; só as do /narrate têm poseMap e expectations para conferir');
  if (v.pending.length) return v;

  // Ações TS dos golpes (`run`): embutidas ou declaradas em sf.actions.json.
  const acts = checkActions(cast.characters, o.actions ?? null);
  errors.push(...acts.errors);
  warnings.push(...acts.warnings);
  if (acts.errors.length) return v;

  let d: Director;
  try {
    checkScene(script, { characters: cast.characters, clips: cast.clips }, 'cena');
    d = await Director.create(script, { characters: cast.characters, clips: cast.clips, onWarning: () => {} }, 'cena');
  } catch (e) {
    errors.push(msg(e));
    return v;
  }
  v.duration = d.duration;
  if (d.duration >= ENDLESS) errors.push(`a cena não termina: ainda há passos rodando depois de ${ENDLESS} s (movimento sem fim? ponha "duration" ou passos que terminam)`);

  // Simulação com eventos (o seek é silencioso): conta eventos e confere o quadro da câmera.
  const expect = n?.expectations.map((e) => e.event) ?? [];
  d.reset();
  for (const name of new Set(['hit', ...expect])) d.on(name, () => (v.events[name] = (v.events[name] ?? 0) + 1));
  d.on('hit', (e: { attacker: string; target: string }) => {
    const k = `hit:${e.attacker}->${e.target}`;
    if (!expect.includes(k)) v.events[k] = (v.events[k] ?? 0) + 1;
  });
  const outSince = new Map<string, number>();
  const reported = new Set<string>();
  try {
    while (d.time < Math.min(d.duration, ENDLESS) - 1e-9) {
      d.step();
      if (Math.round(d.time / SIM_DT) % 12 !== 0) continue;
      const cam = d.world.camera;
      const w = cam.width / cam.zoom, h = cam.height / cam.zoom;
      for (const f of d.fighters) {
        if (f.actor.opacity <= 0) {
          outSince.delete(f.id);
          continue;
        }
        const b = f.actor.bounds();
        const out = b.x + b.w < cam.x - w / 2 || b.x > cam.x + w / 2 || b.y + b.h < cam.y - h / 2 || b.y > cam.y + h / 2;
        if (!out) outSince.delete(f.id);
        else if (!outSince.has(f.id)) outSince.set(f.id, d.time);
        else if (d.time - outSince.get(f.id)! > OUT_OF_FRAME && !reported.has(f.id)) {
          reported.add(f.id);
          errors.push(`"${f.id}" fica fora do quadro da câmera a partir de ${outSince.get(f.id)!.toFixed(1)} s (ajuste posição/rota, câmera, ou esconda o ator)`);
        }
      }
    }
  } catch (e) {
    errors.push(`erro na simulação em ${d.time.toFixed(2)} s: ${msg(e)}`);
  }
  for (const s of d.unfired()) errors.push(`o passo ${s.id ? `"${s.id}" ` : ''}(${s.do}${s.actor ? ` de "${s.actor}"` : ''}) espera "${s.on}"${s.nth > 1 ? ` (${s.nth}ª vez)` : ''}, que nunca acontece`);
  for (const ev of expect) if (!v.events[ev]) errors.push(`a narrativa pede o evento "${ev}", mas ele não acontece (o golpe não acerta? confira distância, direção e tempo)`);
  warnings.push(...d.warnings);
  for (const p of v.provisional) warnings.push(`"${p.char}" usa a pose provisória "${p.pose}" (imagem de "${p.from}"): falta a imagem (ver missing)`);
  v.ok = errors.length === 0;
  return v;
}

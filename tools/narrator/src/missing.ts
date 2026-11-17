import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseManifest, parseMoves, parseScript, type CharacterManifest } from 'sprite-fighter';
import { formatManifest } from '@sprite-fighter/atlas/pose';
import { imagePrompt, variantPrompt, type ImagePrompt } from '@sprite-fighter/atlas/prompt';
import { narrativeFor, type Missing } from './narrative.js';
import { posesUsed } from './used.js';

export interface MissingReport {
  /** Provisórias gravadas agora no manifesto. */
  created: { char: string; name: string; from: string }[];
  /** Linhas do poseMap que passaram de "missing" a "provisional" (char/pose ← from). */
  converted: string[];
  /** Poses que a cena usa sem imagem (provisórias), variantes e golpes que faltam, com o prompt. */
  poses: (ImagePrompt & { char: string; status: string })[];
  variants: (ImagePrompt & { char: string })[];
  moves: Extract<Missing, { kind: 'move' }>[];
  file: string;
  markdown: string;
}

const manifestFile = (assets: string, char: string) => join(assets, 'skins', `${char}.json`);
const readManifest = (assets: string, char: string): CharacterManifest => parseManifest(JSON.parse(readFileSync(manifestFile(assets, char), 'utf8')), char);

/** Grava a provisória (variação neutra a partir de `from`). false = já existia (pose ou provisória). */
async function registerProvisional(assets: string, p: { char: string; name: string; from: string; description: string; tags: string[] }): Promise<boolean> {
  const file = manifestFile(assets, p.char);
  const json = JSON.parse(readFileSync(file, 'utf8')) as { poses: (string | { name: string })[]; provisional?: Record<string, unknown> };
  if (json.poses.some((x) => (typeof x === 'string' ? x : x.name) === p.name) || json.provisional?.[p.name]) return false;
  (json.provisional ??= {})[p.name] = { from: p.from, rotate: 0, sx: 1, sy: 1, description: p.description, tags: p.tags };
  parseManifest(json, p.char); // valida antes de gravar
  await writeFile(file, formatManifest(json));
  return true;
}

/**
 * `missing <cena>`: cria como provisórias as poses declaradas em "missing" do arquivo lateral (a cena
 * passa a rodar, com a marca PROVISÓRIA) e gera `scenes/<nome>.missing.md`, um bloco por imagem que
 * falta, com o prompt montado do manifesto (igual sempre) e o comando `pose:add` já preenchido.
 * Entram também as provisórias que a cena já usava e as variantes e golpes declarados.
 */
export async function runMissing(scenePath: string, o: { assetsDir: string; provisional?: boolean }): Promise<MissingReport> {
  const script = parseScript(JSON.parse(readFileSync(scenePath, 'utf8')), 'cena');
  const { narrative } = narrativeFor(scenePath);
  const declared = narrative?.missing ?? [];
  const created: MissingReport['created'] = [];
  if (o.provisional !== false)
    for (const m of declared)
      if (m.kind === 'pose' && (await registerProvisional(o.assetsDir, { char: m.char, name: m.name, from: m.closest, description: m.description, tags: m.tags })))
        created.push({ char: m.char, name: m.name, from: m.closest });

  // Linhas "missing" do poseMap cuja pose já é provisória (criada agora ou antes) viram "provisional".
  const converted: string[] = [];
  if (narrative?.poseMap.some((p) => p.match === 'missing')) {
    const { file: side } = narrativeFor(scenePath);
    const json = JSON.parse(readFileSync(side, 'utf8')) as { poseMap?: { char: string; pose: string; match: string; from?: string }[] };
    for (const p of json.poseMap ?? []) {
      const prov = p.match === 'missing' ? readManifest(o.assetsDir, p.char).provisional[p.pose] : undefined;
      if (!prov) continue;
      Object.assign(p, { match: 'provisional', from: prov.from });
      converted.push(`${p.char}/${p.pose} ← ${prov.from}`);
    }
    if (converted.length) await writeFile(side, JSON.stringify(json, null, 2) + '\n');
  }

  // Poses sem imagem que a cena usa (provisórias, inclusive as que já existiam) e as declaradas.
  const movesOf = (id: string) => {
    const f = join(o.assetsDir, 'moves', `${id}.moves.json`);
    return existsSync(f) ? parseMoves(JSON.parse(readFileSync(f, 'utf8')), `golpes ${id}`) : undefined;
  };
  const used = posesUsed(script, movesOf);
  for (const m of declared) if (m.kind === 'pose') (used.get(m.char) ?? used.set(m.char, new Set()).get(m.char)!).add(m.name);
  const poses: MissingReport['poses'] = [];
  for (const [char, names] of used) {
    const manifest = readManifest(o.assetsDir, char);
    for (const name of names) {
      const prov = manifest.provisional[name];
      const decl = declared.find((m): m is Extract<Missing, { kind: 'pose' }> => m.kind === 'pose' && m.char === char && m.name === name);
      if (!prov && !decl) continue; // tem imagem
      if (!prov && decl && o.provisional !== false) continue; // não deveria acontecer: acabou de ser criada
      const p = imagePrompt(manifest, name, decl?.description ?? prov?.description, decl?.tags ?? prov?.tags);
      // Sem a provisória gravada, a pose de partida não está no manifesto: anexa a mais parecida.
      const closest = `${manifest.dir}/src/${decl?.closest ?? prov?.from}.png`;
      poses.push({ ...p, char, attach: p.attach.includes(closest) ? p.attach : [...p.attach, closest], status: prov ? `provisória ← ${prov.from}` : `falta (provisória não gravada: --no-provisional)` });
    }
  }
  const variants = declared
    .filter((m): m is Extract<Missing, { kind: 'variant' }> => m.kind === 'variant')
    .map((m) => ({ ...variantPrompt(readManifest(o.assetsDir, m.char), m.pose, m.name, m.variantKind, m.description, m.tags), char: m.char }));
  const moves = declared.filter((m): m is Extract<Missing, { kind: 'move' }> => m.kind === 'move');

  const block = (title: string, p: ImagePrompt) =>
    `## ${title}\n\n### Prompt de imagem\n\n\`\`\`\n${p.prompt}\n\`\`\`\n\n### Anexar\n\n${p.attach.map((a) => `- assets/${a}`).join('\n')}\n\n### Depois de gerar\n\n${p.next.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n`;
  const md = [
    `# O que falta: ${scenePath.replace(/^.*\/assets\//, '')}\n`,
    poses.length || variants.length || moves.length ? '' : 'Nada: todas as poses da cena têm imagem.\n',
    ...poses.map((p) => block(`Pose ${p.char} · ${p.pose} (${p.status})`, p)),
    ...variants.map((p) => block(`Variante ${p.char} · ${p.pose}`, p)),
    ...moves.map(
      (m) =>
        `## Golpe ${m.char} · ${m.name}\n\n${m.why}\n\nEsqueleto para assets/moves/${m.char}.moves.json (as poses novas entram pelo fluxo acima):\n\n\`\`\`json\n${JSON.stringify({ id: m.name, poses: [...new Set(m.phases.map((p) => p.pose))], phases: m.phases }, null, 2)}\n\`\`\`\n`,
    ),
  ].join('\n');
  const file = scenePath.replace(/\.json$/, '.missing.md');
  await writeFile(file, md);
  return { created, converted, poses, variants, moves, file, markdown: md };
}

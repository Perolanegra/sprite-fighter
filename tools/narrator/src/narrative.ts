import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Arquivo lateral de uma cena narrada (`scenes/<nome>.narrative.json`): a narrativa e as decisões
 * de quem escreveu a cena (o Claude Code no /narrate, ou um provedor local no futuro). O roteiro
 * (`scenes/<nome>.json`) fica no formato do motor; isto aqui é o rastro e o que falta.
 *
 *   {
 *     "narrative": "o agente persegue o neo…",
 *     "poseMap": [ { "action": "o neo desvia", "char": "<id>", "pose": "dodge", "match": "provisional", "from": "fly", "reason": "…" } ],
 *     "missing": [
 *       { "kind": "pose", "char": "<id>", "name": "kick_spin", "description": "…", "tags": ["chute"], "closest": "kick", "why": "…" },
 *       { "kind": "variant", "char": "<id>", "pose": "fly", "name": "angry", "variantKind": "expression", "description": "…", "tags": [], "why": "…" },
 *       { "kind": "move", "char": "<id>", "name": "spin_kick", "why": "…", "phases": [ { "name": "giro", "frames": 8, "pose": "kick_spin" } ] }
 *     ],
 *     "expectations": [ { "event": "hit:<a>-><b>", "why": "a narrativa diz que acerta" } ],
 *     "assumptions": [ "posições e tempos escolhidos" ]
 *   }
 *
 * `match`: `exact` (a pose é isso), `similar` (serve, com diferença), `provisional` (a pose existe só
 * como provisória: a imagem é a de `from`, obrigatório) ou `missing` (não existe; declarada em
 * `missing`; quando o comando `missing` cria a provisória, a linha vira `provisional`).
 */
export type Missing =
  | { kind: 'pose'; char: string; name: string; description: string; tags: string[]; closest: string; why: string }
  | { kind: 'variant'; char: string; pose: string; name: string; variantKind: 'expression' | 'hand'; description: string; tags: string[]; why: string }
  | { kind: 'move'; char: string; name: string; why: string; phases: { name: string; frames: number; pose: string }[] };

export const MATCHES = ['exact', 'similar', 'provisional', 'missing'] as const;
export type PoseMapEntry = { action: string; char: string; pose: string; match: (typeof MATCHES)[number]; from?: string; reason: string };

export interface Narrative {
  narrative: string;
  poseMap: PoseMapEntry[];
  missing: Missing[];
  expectations: { event: string; why: string }[];
  assumptions: string[];
}

const SNAKE = /^[a-z0-9_]+$/;

/** Lê e confere o formato; os erros dizem o campo. */
export function parseNarrative(json: unknown, source = 'narrativa'): Narrative {
  const fail = (path: string, msg: string): never => {
    throw new Error(`${source}: ${path}: ${msg}`);
  };
  const o = json as Record<string, unknown>;
  if (!o || typeof o !== 'object' || Array.isArray(o)) fail('', 'esperado um objeto');
  const list = (k: string) => {
    const v = o[k] ?? [];
    if (!Array.isArray(v)) fail(k, 'esperado uma lista');
    return v as Record<string, unknown>[];
  };
  const text = (v: unknown, path: string, required = true) => {
    if (typeof v !== 'string' || (required && !v.trim())) fail(path, 'esperado um texto');
    return v as string;
  };
  const tags = (v: unknown, path: string) => {
    const t = (v ?? []) as unknown[];
    if (!Array.isArray(t) || t.some((x) => typeof x !== 'string')) fail(path, 'esperado uma lista de textos');
    t.forEach((x, i) => (x as string) !== (x as string).toLowerCase() && fail(`${path}[${i}]`, 'tags em minúsculas'));
    return t as string[];
  };
  const poseMap = list('poseMap').map((p, i) => {
    const match = p['match'] as PoseMapEntry['match'];
    if (!MATCHES.includes(match)) fail(`poseMap[${i}].match`, `esperado ${MATCHES.join(', ')}`);
    if (match === 'provisional' && typeof p['from'] !== 'string') fail(`poseMap[${i}].from`, 'match "provisional" precisa de "from" (a pose cuja imagem a provisória usa)');
    if (match !== 'provisional' && p['from'] !== undefined) fail(`poseMap[${i}].from`, '"from" só vale com match "provisional"');
    return {
      action: text(p['action'], `poseMap[${i}].action`),
      char: text(p['char'], `poseMap[${i}].char`),
      pose: text(p['pose'], `poseMap[${i}].pose`),
      match,
      ...(match === 'provisional' ? { from: p['from'] as string } : {}),
      reason: text(p['reason'] ?? '', `poseMap[${i}].reason`, false),
    };
  });
  const missing = list('missing').map((m, i): Missing => {
    const at = `missing[${i}]`;
    const name = text(m['name'], `${at}.name`);
    if (!SNAKE.test(name)) fail(`${at}.name`, `"${name}" precisa ser snake_case`);
    const base = { char: text(m['char'], `${at}.char`), name, why: text(m['why'] ?? '', `${at}.why`, false) };
    switch (m['kind']) {
      case 'pose':
        return { kind: 'pose', ...base, description: text(m['description'], `${at}.description`), tags: tags(m['tags'], `${at}.tags`), closest: text(m['closest'], `${at}.closest`) };
      case 'variant': {
        const vk = m['variantKind'];
        if (vk !== 'expression' && vk !== 'hand') fail(`${at}.variantKind`, 'esperado expression ou hand');
        return { kind: 'variant', ...base, pose: text(m['pose'], `${at}.pose`), variantKind: vk as 'hand', description: text(m['description'], `${at}.description`), tags: tags(m['tags'], `${at}.tags`) };
      }
      case 'move': {
        const phases = (m['phases'] ?? []) as Record<string, unknown>[];
        if (!Array.isArray(phases)) fail(`${at}.phases`, 'esperado uma lista');
        return { kind: 'move', ...base, phases: phases.map((p, j) => ({ name: text(p['name'], `${at}.phases[${j}].name`), frames: Number(p['frames']), pose: text(p['pose'], `${at}.phases[${j}].pose`) })) };
      }
      default:
        return fail(`${at}.kind`, 'esperado pose, variant ou move');
    }
  });
  return {
    narrative: text(o['narrative'] ?? '', 'narrative', false),
    poseMap,
    missing,
    expectations: list('expectations').map((e, i) => ({ event: text(e['event'], `expectations[${i}].event`), why: text(e['why'] ?? '', `expectations[${i}].why`, false) })),
    assumptions: list('assumptions').map((a, i) => text(a, `assumptions[${i}]`)),
  };
}

/** `scenes/x.json` → `scenes/x.narrative.json` (null se não existir). */
export function narrativeFor(scenePath: string): { file: string; narrative: Narrative | null } {
  const file = resolve(scenePath).replace(/\.json$/, '.narrative.json');
  return { file, narrative: existsSync(file) ? parseNarrative(JSON.parse(readFileSync(file, 'utf8')), file.replace(/^.*\/assets\//, '')) : null };
}

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTHOR_FPS,
  COMMANDS,
  EVENTS,
  FX_PRESETS,
  FX_TYPES,
  TRANSITIONS,
  actionNames,
  getPropType,
  parseClip,
  parseManifest,
  parseMoves,
  propTypes,
  type MoveData,
} from 'sprite-fighter';
import { COMMAND_DOCS } from 'sprite-fighter/authoring';
import { isBuiltinAction, type DeclaredAction } from './actions.js';

/**
 * Catálogo do que existe no projeto, montado só dos manifestos e dados (nada escrito à mão): é o
 * que o narrador pode usar num roteiro. Saída estável (chaves em ordem) para conferir e cachear.
 */
export interface Catalog {
  characters: Record<
    string,
    {
      name: string | null;
      description: string | null;
      basePose: string;
      poses: Record<string, { description: string; tags: string[]; provisional: false; variants: Record<string, { kind: string; description: string; tags: string[] }> }>;
      provisional: Record<string, { description: string; tags: string[]; provisional: true; from: string }>;
      moves: Record<string, { poses: string[]; seconds: number; attacks: 'hitbox' | 'projectile' | 'both' | null; targetPose: string | null }>;
    }
  >;
  clips: Record<string, { seconds: number; loop: boolean }>;
  fx: string[];
  props: Record<string, { states: string[]; actions: string[] }>;
  /** Ações TS para o `run` das fases: as embutidas e as do app (`sf.actions.json`), com os parâmetros. */
  actions: Record<string, { builtin: boolean; description: string; params: Record<string, string> }>;
  transitions: string[];
  commands: Record<string, { actor: string; params: string[]; doc: string }>;
  events: Record<string, string>;
}

/** Monta o catálogo a partir de `assetsDir` (assets/skins, assets/moves, assets/clips). */
export function buildCatalog(assetsDir: string, declared: DeclaredAction[] | null = null): Catalog {
  const json = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as unknown;
  const characters: Catalog['characters'] = {};
  for (const f of readdirSync(join(assetsDir, 'skins')).filter((f) => f.endsWith('.json')).sort()) {
    const id = f.replace(/\.json$/, '');
    const m = parseManifest(json(join(assetsDir, 'skins', f)), id);
    const movesFile = join(assetsDir, 'moves', `${id}.moves.json`);
    const moves: Map<string, MoveData> = existsSync(movesFile) ? parseMoves(json(movesFile), `golpes ${id}`) : new Map();
    characters[id] = {
      name: m.character?.name ?? null,
      description: m.character?.description ?? null,
      basePose: m.default,
      poses: Object.fromEntries(
        m.poses.map((p) => [
          p.name,
          { description: p.description, tags: p.tags, provisional: false as const, variants: Object.fromEntries(p.variants.map((v) => [v.name, { kind: v.kind, description: v.description, tags: v.tags }])) },
        ]),
      ),
      provisional: Object.fromEntries(Object.entries(m.provisional).map(([n, v]) => [n, { description: v.description, tags: v.tags, provisional: true as const, from: v.from }])),
      moves: Object.fromEntries(
        [...moves.values()].map((mv) => {
          const hit = mv.phases.some((ph) => ph.hitboxes.length), shot = mv.phases.some((ph) => ph.spawn);
          return [
            mv.id,
            {
              poses: mv.poses,
              seconds: +(mv.phases.reduce((s, ph) => s + ph.frames, 0) / AUTHOR_FPS).toFixed(3),
              attacks: hit && shot ? 'both' : hit ? 'hitbox' : shot ? 'projectile' : null,
              targetPose: mv.onHit?.targetPose ?? null,
            },
          ];
        }),
      ),
    };
  }
  const clipIds = json(join(assetsDir, 'clips', 'index.json')) as string[];
  const clips: Catalog['clips'] = {};
  for (const id of clipIds) {
    const c = parseClip(json(join(assetsDir, 'clips', `${id}.json`)), `clip ${id}`);
    clips[id] = { seconds: +(c.frames / AUTHOR_FPS).toFixed(3), loop: c.loop };
  }
  return sortKeys({
    characters,
    clips,
    fx: [...FX_TYPES, ...Object.keys(FX_PRESETS)].sort(),
    props: Object.fromEntries(propTypes().map((t) => [t, { states: getPropType(t)!.states, actions: [...Object.keys(getPropType(t)!.actions), 'remove'] }])),
    actions: Object.fromEntries([
      ...actionNames().filter(isBuiltinAction).map((n) => [n, { builtin: true, description: '', params: {} }] as const),
      ...(declared ?? []).map((a) => [a.name, { builtin: false, description: a.description, params: a.params }] as const),
    ]),
    transitions: [...TRANSITIONS],
    commands: Object.fromEntries(Object.entries(COMMANDS).map(([k, c]) => [k, { actor: c.actor, params: Object.keys(c.params), doc: COMMAND_DOCS[k]?.doc ?? '' }])),
    events: Object.fromEntries(Object.entries(EVENTS).map(([k, e]) => [k, e.doc])),
  });
}

/** Objetos com as chaves em ordem (listas mantêm a ordem). */
export function sortKeys<T>(v: T): T {
  if (Array.isArray(v)) return v.map(sortKeys) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) as T;
  return v;
}

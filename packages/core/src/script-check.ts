import type { ClipData } from './clip.js';
import { FX_TYPES, type CastMember } from './director.js';
import { getPropType, propTypes } from './props.js';
import { eachStep, parseScript, type Script } from './script.js';
import { DataError } from './validate.js';
import { FX_PRESETS } from './world.js';

/** O que existe para cada ator (poses, golpes) e na cena (clipes, efeitos, props). */
export interface ScriptCatalog {
  poses(actor: string): Set<string>;
  moves(actor: string): Set<string>;
  clips: Set<string>;
  /** Tipos de efeito e presets aceitos (omitido = não confere). */
  fx?: Set<string>;
  /** Tipos de prop e as ações de cada um. */
  props: Map<string, { states: string[]; actions: string[] }>;
}

/** Confere os nomes citados pelo roteiro contra o que os personagens e a cena têm. */
export function checkScript(script: Script, catalog: ScriptCatalog, source = 'roteiro'): void {
  const fail = (path: string, detail: string): never => {
    throw new DataError(source, path, detail);
  };
  const list = (s: Set<string> | string[]) => [...s].join(', ') || 'nenhum';
  const propType = new Map<string, string>();
  eachStep(script.steps, (s) => {
    if (s.do === 'spawnProp') propType.set((s.params['id'] as string | undefined) ?? (s.params['type'] as string), s.params['type'] as string);
  });
  for (const [id, c] of script.cast) {
    if (c.pose && !catalog.poses(id).has(c.pose)) fail(`cast.${id}.pose`, `"${id}" não tem a pose "${c.pose}" (poses: ${list(catalog.poses(id))})`);
    if (c.clip && !catalog.clips.has(c.clip)) fail(`cast.${id}.clip`, `clipe "${c.clip}" não existe (clipes: ${list(catalog.clips)})`);
  }
  eachStep(script.steps, (s, path) => {
    const p = s.params;
    const a = s.actor;
    if (s.do === 'pose' && a && !catalog.poses(a).has(p['name'] as string)) fail(`${path}.params.name`, `"${a}" não tem a pose "${p['name']}" (poses: ${list(catalog.poses(a))})`);
    if (s.do === 'move' && a && !catalog.moves(a).has(p['id'] as string)) fail(`${path}.params.id`, `"${a}" não tem o golpe "${p['id']}" (golpes: ${list(catalog.moves(a))})`);
    if (s.do === 'play' && !catalog.clips.has(p['clip'] as string)) fail(`${path}.params.clip`, `clipe "${p['clip']}" não existe (clipes: ${list(catalog.clips)})`);
    if (s.do === 'fx' && catalog.fx && !catalog.fx.has(p['type'] as string)) fail(`${path}.params.type`, `efeito "${p['type']}" não existe (efeitos: ${list(catalog.fx)})`);
    if (s.do === 'spawnProp') {
      const t = catalog.props.get(p['type'] as string);
      if (!t) fail(`${path}.params.type`, `tipo de prop "${p['type']}" não registrado (tipos: ${list([...catalog.props.keys()])})`);
      if (p['state'] !== undefined && !t!.states.includes(p['state'] as string)) fail(`${path}.params.state`, `estado "${p['state']}" não existe em "${p['type']}" (estados: ${list(t!.states)})`);
    }
    if (s.do === 'prop' && p['action'] !== 'remove') {
      const t = catalog.props.get(propType.get(p['id'] as string) ?? '');
      if (t && !t.actions.includes(p['action'] as string)) fail(`${path}.params.action`, `"${p['id']}" não tem a ação "${p['action']}" (ações: ${list([...t.actions, 'remove'])})`);
    }
  });
}

/**
 * Conferência detalhada de um roteiro contra os personagens carregados e a cena (autoria: o
 * `narrate validate` e o debug usam). Diz o que não existe e lista o que existe. O player não
 * passa por aqui: um nome errado só falha quando é usado (carga da pose, golpe, clipe).
 */
export function checkScene(
  script: Script | unknown,
  options: { characters: Record<string, CastMember> | Map<string, CastMember>; clips?: Map<string, ClipData> },
  source = 'roteiro',
): Script {
  const s = isScript(script) ? script : parseScript(script, source);
  const cast = options.characters instanceof Map ? options.characters : new Map(Object.entries(options.characters));
  const member = (id: string) => {
    const m = cast.get(id);
    if (!m) throw new DataError(source, `cast.${id}`, `"${id}" não foi carregado (personagens: ${[...cast.keys()].join(', ')})`);
    return m;
  };
  checkScript(
    s,
    {
      poses: (id) => member(id).character.availablePoses(),
      moves: (id) => new Set(member(id).moves?.keys() ?? []),
      clips: new Set(options.clips?.keys() ?? []),
      fx: new Set([...FX_TYPES, ...Object.keys(FX_PRESETS)]),
      props: new Map(propTypes().map((t) => [t, { states: getPropType(t)!.states, actions: Object.keys(getPropType(t)!.actions) }])),
    },
    source,
  );
  return s;
}

const isScript = (v: unknown): v is Script => !!v && typeof v === 'object' && (v as Script).cast instanceof Map;

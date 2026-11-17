import { EASE_NAMES } from './easing.js';
import type { Vec2 } from './math.js';
import { DataError, Reader } from './validate.js';

/**
 * Roteiro de cena (`scenes/<nome>.json`). Só dados: ids dos personagens (os do manifesto), poses,
 * golpes, clipes, props e efeitos pelo nome. Nada de lógica de personagem.
 *
 *   {
 *     "title": "…", "seed": 3,
 *     "cast": { "<id>": { "at": [-100, 640], "scale": 0.32 } },   // ordem = ordem de desenho
 *     "camera": { "mode": "auto", "maxZoom": 0.6 },
 *     "steps": [
 *       { "id": "fuga", "at": 0, "actor": "<id>", "do": "moveTo", "params": { "route": "M…", "duration": 2.2 } },
 *       { "after": "fuga", "delay": 0.2, "actor": "<id>", "do": "pose", "params": { "name": "<pose>" } },
 *       { "on": "hit:<prop>-><id>", "actor": "<id>", "do": "parallel", "params": { "steps": [ … ] } }
 *     ]
 *   }
 *
 * Cada passo começa por **uma** destas: `at` (s, tempo absoluto), `after` (id de outro passo: quando
 * ele terminar) ou `on` (evento; `nth` = qual ocorrência, padrão 1). `delay` (s) soma nos três.
 * Também aceita só a lista de passos (sem cast/câmera), para trechos.
 */

export type ParamKind = 'number' | 'string' | 'bool' | 'vec2' | 'strings' | 'zoom';

export interface ParamSpec {
  kind: ParamKind;
  required?: boolean;
  /** Valores aceitos (texto). */
  values?: readonly string[];
  /** O valor é id de: ator do elenco, prop criado no roteiro ou qualquer um dos dois. */
  ref?: 'actor' | 'prop' | 'any';
}

export interface CommandSpec {
  /** O passo precisa de `actor`? */
  actor: 'required' | 'optional' | 'none';
  params: Record<string, ParamSpec>;
  /** Aceita parâmetros extras (efeitos repassam tudo ao `fx`). */
  open?: boolean;
  /** Exige exatamente um destes parâmetros. */
  exactlyOne?: string[];
}

export const TRANSITIONS = ['smear', 'afterimage', 'flash', 'cut'] as const;
const EASES = EASE_NAMES as readonly string[];
const num = (required = false): ParamSpec => ({ kind: 'number', required });
const str = (required = false, ref?: ParamSpec['ref']): ParamSpec => ({ kind: 'string', required, ...(ref ? { ref } : {}) });
const pick = (values: readonly string[], required = false): ParamSpec => ({ kind: 'string', values, required });

/** Os comandos do roteiro (`do`) e seus parâmetros (a descrição de cada um fica em `sprite-fighter/authoring`, `COMMAND_DOCS`). */
export const COMMANDS: Record<string, CommandSpec> = {
  pose: {
    actor: 'required',
    params: { name: str(true), transition: pick(TRANSITIONS), skin: pick(['image', 'parts']) },
  },
  move: {
    actor: 'required',
    params: { id: str(true), target: str(false, 'actor') },
  },
  moveTo: {
    actor: 'required',
    exactlyOne: ['to', 'route'],
    params: {
      to: { kind: 'vec2' },
      route: str(),
      relative: { kind: 'bool' },
      duration: num(true),
      ease: pick(EASES),
      scaleTo: num(),
    },
  },
  dash: {
    actor: 'required',
    params: { velocity: { kind: 'vec2', required: true }, drag: num(), duration: num() },
  },
  hover: { actor: 'required', params: {} },
  fall: { actor: 'required', params: { vx: num(), vy: num(), gravity: num() } },
  face: { actor: 'required', exactlyOne: ['target', 'dir'], params: { target: str(false, 'any'), dir: num() } },
  play: { actor: 'required', params: { clip: str(true), fade: num(), speed: num() } },
  camera: {
    actor: 'none',
    params: {
      mode: pick(['auto', 'follow', 'pan']),
      follow: str(false, 'actor'),
      pan: { kind: 'vec2' },
      targets: { kind: 'strings', ref: 'any' },
      zoom: { kind: 'zoom' },
      seconds: num(),
      shake: num(),
      margin: num(),
      minZoom: num(),
      maxZoom: num(),
      snap: { kind: 'bool' },
    },
  },
  fx: {
    actor: 'optional',
    open: true,
    params: { type: str(true), at: { kind: 'vec2' }, dir: { kind: 'vec2' } },
  },
  spawnProp: {
    actor: 'none',
    params: {
      type: str(true),
      id: str(),
      at: { kind: 'vec2', required: true },
      size: { kind: 'vec2', required: true },
      state: str(),
      appear: num(),
    },
  },
  prop: {
    actor: 'none',
    params: { id: str(true, 'prop'), action: str(true), duration: num() },
  },
  enter: {
    actor: 'required',
    params: { prop: str(true, 'prop'), duration: num(true), ease: pick(EASES) },
  },
  touch: { actor: 'required', params: { prop: str(true, 'prop'), gap: num() } },
  opacity: { actor: 'required', params: { value: num(true) } },
  expression: {
    actor: 'required',
    params: { name: str(true) },
  },
  hand: {
    actor: 'required',
    params: { name: str(true) },
  },
  say: { actor: 'required', params: { text: str(true), seconds: num() } },
  wait: { actor: 'none', params: { seconds: num(true) } },
  parallel: { actor: 'optional', params: {} },
};

/** Eventos que um passo `on` pode esperar e os ids que cada um leva. */
export const EVENTS: Record<string, { args: 0 | 1 | 2 | '0|2'; doc: string }> = {
  hit: { args: '0|2', doc: 'contato: "hit" ou "hit:<atacante>-><alvo>" (atacante pode ser prop)' },
  spawn: { args: 1, doc: 'projétil disparado: "spawn:<dono>"' },
  incoming: { args: 2, doc: 'projétil chegando perto: "incoming:<dono>-><alvo>"' },
  moveEnd: { args: 1, doc: 'golpe terminou: "moveEnd:<id>"' },
  start: { args: 1, doc: 'passo começou: "start:<passo>"' },
  done: { args: 1, doc: 'passo terminou: "done:<passo>"' },
};

export interface CastSpec {
  at: Vec2;
  scale: number;
  facing: 1 | -1;
  /** Pose inicial (padrão: a base do manifesto). */
  pose: string | null;
  /** Clipe em laço desde o início (padrão: nenhum). */
  clip: string | null;
  opacity: number;
  /** Colide com props sólidos. */
  collideProps: boolean;
}

export interface ScriptStep {
  id: string | null;
  at: number | null;
  after: string | null;
  on: string | null;
  nth: number;
  delay: number;
  actor: string | null;
  do: string;
  params: Record<string, unknown>;
  /** Filhos do `parallel`. */
  steps: ScriptStep[];
}

export interface Script {
  title: string;
  seed: number;
  /** Duração (s); null = mede (fim do último passo + `tail`). */
  duration: number | null;
  tail: number;
  /** Elenco na ordem de desenho. */
  cast: Map<string, CastSpec>;
  camera: Record<string, unknown> | null;
  steps: ScriptStep[];
}

const ID = /^[A-Za-z0-9_-]+$/;
const EVENT = /^([A-Za-z]+)(?::([A-Za-z0-9_-]+)(?:->([A-Za-z0-9_-]+))?)?$/;

function readParam(r: Reader, spec: ParamSpec): unknown {
  switch (spec.kind) {
    case 'number':
      return r.number();
    case 'string': {
      const v = r.string();
      if (spec.values && !spec.values.includes(v)) r.fail(`esperado um de: ${spec.values.join(', ')}`);
      return v;
    }
    case 'bool':
      if (typeof r.value !== 'boolean') r.fail('esperado true ou false');
      return r.value;
    case 'vec2': {
      const [x, y] = r.pair();
      return { x, y };
    }
    case 'strings':
      return r.array().map((i) => i.string());
    case 'zoom':
      return r.value === null ? null : r.number();
  }
}

function readParams(r: Reader, cmd: string): Record<string, unknown> {
  const spec = COMMANDS[cmd]!;
  const raw = r.present ? r.object() : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    const p = spec.params[key];
    if (p) {
      // `zoom: null` é um valor (solta o zoom); nos outros, null = ausente.
      if (raw[key] === null && p.kind !== 'zoom') continue;
      out[key] = readParam(r.at(key), p);
    } else if (cmd === 'parallel' && key === 'steps') continue;
    else if (spec.open) out[key] = raw[key];
    else r.at(key).fail(`parâmetro desconhecido em "${cmd}" (aceitos: ${Object.keys(spec.params).join(', ') || 'nenhum'})`);
  }
  for (const [key, p] of Object.entries(spec.params)) if (p.required && !(key in out)) r.at(key).fail(`obrigatório em "${cmd}"`);
  if (spec.exactlyOne && spec.exactlyOne.filter((k) => k in out).length !== 1) r.fail(`"${cmd}" precisa de exatamente um de: ${spec.exactlyOne.join(', ')}`);
  return out;
}

const STEP_KEYS = new Set(['id', 'at', 'after', 'on', 'nth', 'delay', 'actor', 'do', 'params']);

function readStep(r: Reader, child: boolean): ScriptStep {
  const o = r.object();
  for (const k of Object.keys(o)) if (!STEP_KEYS.has(k)) r.at(k).fail(`campo desconhecido (aceitos: ${[...STEP_KEYS].join(', ')})`);
  const cmd = r.at('do').oneOf(Object.keys(COMMANDS));
  const id = r.at('id').optString() ?? null;
  if (id !== null && !ID.test(id)) r.at('id').fail('use só letras, números, _ e -');
  const at = r.at('at').present ? r.at('at').number() : null;
  const after = r.at('after').optString() ?? null;
  const on = r.at('on').optString() ?? null;
  const timing = [at, after, on].filter((v) => v !== null).length;
  if (child && timing) r.fail('passo dentro de "parallel" não leva at/after/on (só delay)');
  if (!child && timing !== 1) r.fail('cada passo começa por exatamente um de: at (s), after (id de passo) ou on (evento)');
  if (at !== null && at < 0) r.at('at').fail('tempo negativo');
  const nth = r.at('nth').optNumber(1);
  if (!Number.isInteger(nth) || nth < 1) r.at('nth').fail('esperado um inteiro ≥ 1');
  if (r.at('nth').present && on === null) r.at('nth').fail('"nth" só vale com "on"');
  const delay = r.at('delay').optNumber(0);
  if (delay < 0) r.at('delay').fail('delay negativo');
  const actor = r.at('actor').optString() ?? null;
  const spec = COMMANDS[cmd]!;
  // Filho do parallel herda o ator do pai (conferido lá).
  if (spec.actor === 'required' && !actor && !child) r.at('actor').fail(`"${cmd}" precisa de "actor"`);
  if (spec.actor === 'none' && actor) r.at('actor').fail(`"${cmd}" não usa "actor"`);
  const params = readParams(r.at('params'), cmd);
  let steps: ScriptStep[] = [];
  if (cmd === 'parallel') {
    const list = r.at('params').at('steps');
    steps = list.array().map((c) => readStep(c, true));
    if (!steps.length) list.fail('"parallel" precisa de pelo menos um passo');
    // O ator do parallel vale para os filhos que não dizem o seu.
    for (const [i, c] of steps.entries()) {
      if (!c.actor && actor && COMMANDS[c.do]!.actor !== 'none') c.actor = actor;
      if (COMMANDS[c.do]!.actor === 'required' && !c.actor) list.at(i).at('actor').fail(`"${c.do}" precisa de "actor"`);
    }
  }
  return { id, at, after, on, nth, delay, actor, do: cmd, params, steps };
}

function readCast(r: Reader): Map<string, CastSpec> {
  const cast = new Map<string, CastSpec>();
  for (const id of Object.keys(r.object())) {
    const c = r.at(id);
    if (!ID.test(id)) c.fail('id do elenco: só letras, números, _ e -');
    const facing = c.at('facing').optNumber(1);
    if (facing !== 1 && facing !== -1) c.at('facing').fail('esperado 1 ou -1');
    cast.set(id, {
      at: c.at('at').present ? (([x, y]) => ({ x, y }))(c.at('at').pair()) : { x: 0, y: 0 },
      scale: c.at('scale').optNumber(1),
      facing: facing as 1 | -1,
      pose: c.at('pose').optString() ?? null,
      clip: c.at('clip').optString() ?? null,
      opacity: c.at('opacity').optNumber(1),
      collideProps: c.at('collideProps').present ? c.at('collideProps').value === true : true,
    });
  }
  return cast;
}

/** Percorre todos os passos (inclusive os filhos do `parallel`). */
export function eachStep(steps: ScriptStep[], fn: (s: ScriptStep, path: string) => void, path = 'steps'): void {
  steps.forEach((s, i) => {
    fn(s, `${path}[${i}]`);
    eachStep(s.steps, fn, `${path}[${i}].params.steps`);
  });
}

/**
 * Lê e valida um roteiro: formato, comandos e parâmetros, ids de `after` (existem, sem ciclo),
 * eventos `on` bem formados e ids citados (elenco, props criados no roteiro, passos).
 * Poses, golpes e clipes de cada ator: na carga das poses e na execução; a conferência detalhada, com
 * as listas do que existe, é `checkScript` (`sprite-fighter/authoring`).
 */
export function parseScript(json: unknown, source = 'roteiro'): Script {
  const root = new Reader(source, Array.isArray(json) ? { steps: json } : json);
  root.object();
  const known = new Set(['title', 'seed', 'duration', 'tail', 'cast', 'camera', 'steps']);
  for (const k of Object.keys(root.object())) if (!known.has(k)) root.at(k).fail(`campo desconhecido (aceitos: ${[...known].join(', ')})`);
  const cast = root.at('cast').present ? readCast(root.at('cast')) : new Map<string, CastSpec>();
  const steps = root.at('steps').array().map((s) => readStep(s, false));
  const camera = root.at('camera').present ? readParams(root.at('camera'), 'camera') : null;
  const script: Script = {
    title: root.at('title').optString() ?? '',
    seed: root.at('seed').optNumber(1),
    duration: root.at('duration').present ? root.at('duration').number() : null,
    tail: root.at('tail').optNumber(0.8),
    cast,
    camera,
    steps,
  };

  const fail = (path: string, detail: string): never => {
    throw new DataError(source, path, detail);
  };
  // Ids de passo únicos; props criados (id → tipo).
  const ids = new Map<string, ScriptStep>();
  const props = new Set<string>();
  eachStep(steps, (s, path) => {
    if (s.id) {
      if (ids.has(s.id)) fail(`${path}.id`, `id "${s.id}" repetido`);
      ids.set(s.id, s);
    }
    if (s.do === 'spawnProp') props.add((s.params['id'] as string | undefined) ?? (s.params['type'] as string));
  });
  const checkRef = (path: string, id: string, ref: ParamSpec['ref']) => {
    const ok = ref === 'actor' ? cast.has(id) : ref === 'prop' ? props.has(id) : cast.has(id) || props.has(id);
    if (!ok) fail(path, `"${id}" não é ${ref === 'actor' ? 'do elenco' : ref === 'prop' ? 'um prop criado no roteiro (spawnProp)' : 'do elenco nem um prop do roteiro'} (elenco: ${[...cast.keys()].join(', ') || 'vazio'}${props.size ? `; props: ${[...props].join(', ')}` : ''})`);
  };
  const checkParams = (params: Record<string, unknown>, cmd: string, path: string) => {
    for (const [key, p] of Object.entries(COMMANDS[cmd]!.params)) {
      const v = params[key];
      if (!p.ref || v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x, i) => checkRef(`${path}.${key}[${i}]`, x as string, p.ref));
      else checkRef(`${path}.${key}`, v as string, p.ref);
    }
  };
  if (camera) checkParams(camera, 'camera', 'camera');
  eachStep(steps, (s, path) => {
    if (s.actor) checkRef(`${path}.actor`, s.actor, 'actor');
    checkParams(s.params, s.do, `${path}.params`);
    if (s.after !== null && !ids.has(s.after)) fail(`${path}.after`, `nenhum passo com id "${s.after}"`);
    if (s.on !== null) {
      const m = EVENT.exec(s.on);
      const ev = m && EVENTS[m[1]!];
      if (!m || !ev) fail(`${path}.on`, `evento "${s.on}" mal formado (eventos: ${Object.entries(EVENTS).map(([k, e]) => `${k} — ${e.doc}`).join('; ')})`);
      const args = [m![2], m![3]].filter((x): x is string => !!x);
      const okCount = ev!.args === '0|2' ? args.length === 0 || args.length === 2 : args.length === ev!.args;
      if (!okCount) fail(`${path}.on`, `"${s.on}": ${ev!.doc}`);
      const kind = m![1]!;
      args.forEach((a) => {
        if (kind === 'start' || kind === 'done') {
          if (!ids.has(a)) fail(`${path}.on`, `nenhum passo com id "${a}"`);
        } else checkRef(`${path}.on`, a, kind === 'hit' ? 'any' : 'actor');
      });
    }
  });
  // `after` sem ciclo (a → b → a nunca começaria).
  for (const s of ids.values()) {
    const seen = new Set<string>();
    let cur: ScriptStep | undefined = s;
    while (cur?.after) {
      if (seen.has(cur.after)) fail('steps', `ciclo de "after": ${[...seen, cur.after].join(' → ')}`);
      seen.add(cur.after);
      cur = ids.get(cur.after);
    }
  }
  return script;
}

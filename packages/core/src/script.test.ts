import { describe, expect, it } from 'vitest';
import { COMMANDS, parseScript } from './script.js';
import { checkScript, type ScriptCatalog } from './script-check.js';
import { COMMAND_DOCS, scriptSchema } from './script-docs.js';
import { script } from './script-builder.js';

const CAST = { a: { at: [0, 0] }, b: { at: [400, 0], facing: -1 } };
const ok = (steps: unknown[], extra: Record<string, unknown> = {}) => parseScript({ cast: CAST, steps, ...extra });
const bad = (steps: unknown[]) => () => ok(steps);

describe('parseScript', () => {
  it('lê at/after/on, delay, nth e os filhos do parallel (que herdam o ator)', () => {
    const s = ok([
      { id: 'ida', at: 0.5, actor: 'a', do: 'moveTo', params: { to: [10, 20], duration: 1 } },
      { after: 'ida', delay: 0.2, actor: 'a', do: 'pose', params: { name: 'punch' } },
      { on: 'hit:a->b', nth: 2, actor: 'b', do: 'parallel', params: { steps: [{ do: 'hover' }, { delay: 0.1, do: 'play', params: { clip: 'x' } }] } },
    ]);
    expect(s.cast.get('b')).toMatchObject({ at: { x: 400, y: 0 }, facing: -1, scale: 1, collideProps: true });
    expect(s.steps[0]).toMatchObject({ id: 'ida', at: 0.5, params: { to: { x: 10, y: 20 }, duration: 1 } });
    expect(s.steps[1]).toMatchObject({ after: 'ida', delay: 0.2, at: null });
    expect(s.steps[2]!.nth).toBe(2);
    expect(s.steps[2]!.steps.map((c) => [c.actor, c.do, c.delay])).toEqual([['b', 'hover', 0], ['b', 'play', 0.1]]);
  });

  it('aceita só a lista de passos', () => {
    expect(parseScript([{ at: 0, do: 'wait', params: { seconds: 1 } }]).steps).toHaveLength(1);
  });

  it('mensagens claras para roteiros ruins', () => {
    expect(bad([{ actor: 'a', do: 'hover' }])).toThrow(/steps\[0\]: cada passo começa por exatamente um de: at/);
    expect(bad([{ at: 0, on: 'hit', actor: 'a', do: 'hover' }])).toThrow(/exatamente um de/);
    expect(bad([{ at: 0, actor: 'a', do: 'voar' }])).toThrow(/steps\[0\]\.do: esperado um de: pose, move/);
    expect(bad([{ at: 0, actor: 'a', do: 'pose', params: { nome: 'x' } }])).toThrow(/params\.nome: parâmetro desconhecido em "pose"/);
    expect(bad([{ at: 0, actor: 'a', do: 'pose' }])).toThrow(/params\.name: obrigatório em "pose"/);
    expect(bad([{ at: 0, actor: 'a', do: 'pose', params: { name: 'x', transition: 'wipe' } }])).toThrow(/transition: esperado um de: smear/);
    expect(bad([{ at: 0, actor: 'a', do: 'moveTo', params: { duration: 1 } }])).toThrow(/exatamente um de: to, route/);
    expect(bad([{ at: 0, do: 'pose', params: { name: 'x' } }])).toThrow(/"pose" precisa de "actor"/);
    expect(bad([{ at: 0, actor: 'c', do: 'hover' }])).toThrow(/steps\[0\]\.actor: "c" não é do elenco \(elenco: a, b\)/);
    expect(bad([{ at: 0, actor: 'a', do: 'move', params: { id: 'jab', target: 'z' } }])).toThrow(/params\.target: "z" não é do elenco/);
    expect(bad([{ after: 'nada', actor: 'a', do: 'hover' }])).toThrow(/after: nenhum passo com id "nada"/);
    expect(bad([{ on: 'acertou', actor: 'a', do: 'hover' }])).toThrow(/on: evento "acertou" mal formado/);
    expect(bad([{ on: 'incoming:a', actor: 'a', do: 'hover' }])).toThrow(/projétil chegando perto/);
    expect(bad([{ on: 'hit:porta->a', actor: 'a', do: 'hover' }])).toThrow(/"porta" não é do elenco nem um prop/);
    expect(bad([{ at: 0, nth: 2, actor: 'a', do: 'hover' }])).toThrow(/"nth" só vale com "on"/);
    expect(bad([{ at: 0, actor: 'a', do: 'enter', params: { prop: 'door', duration: 1 } }])).toThrow(/não é um prop criado no roteiro/);
    expect(bad([{ at: 0, do: 'parallel', params: { steps: [{ at: 1, do: 'wait', params: { seconds: 1 } }] } }])).toThrow(/dentro de "parallel" não leva at/);
    expect(bad([{ at: 0, do: 'parallel', params: { steps: [{ do: 'hover' }] } }])).toThrow(/params\.steps\[0\]\.actor: "hover" precisa de "actor"/);
    expect(bad([
      { id: 'x', after: 'y', do: 'wait', params: { seconds: 1 } },
      { id: 'y', after: 'x', do: 'wait', params: { seconds: 1 } },
    ])).toThrow(/ciclo de "after"/);
    expect(bad([
      { id: 'x', at: 0, do: 'wait', params: { seconds: 1 } },
      { id: 'x', at: 1, do: 'wait', params: { seconds: 1 } },
    ])).toThrow(/id "x" repetido/);
  });

  it('o evento "hit" aceita prop criado no roteiro', () => {
    const s = ok([
      { at: 0, do: 'spawnProp', params: { type: 'door', id: 'porta', at: [0, 0], size: [10, 100] } },
      { on: 'hit:porta->a', actor: 'a', do: 'hover' },
    ]);
    expect(s.steps[1]!.on).toBe('hit:porta->a');
  });
});

describe('checkScript', () => {
  const catalog: ScriptCatalog = {
    poses: () => new Set(['fly', 'punch']),
    moves: (id) => new Set(id === 'a' ? ['jab'] : []),
    clips: new Set(['idle']),
    fx: new Set(['impact']),
    props: new Map([['door', { states: ['open', 'closed'], actions: ['open', 'close'] }]]),
  };
  const check = (steps: unknown[]) => () => checkScript(ok(steps), catalog);
  it('confere poses, golpes, clipes, efeitos e props contra o que existe', () => {
    expect(check([{ at: 0, actor: 'a', do: 'pose', params: { name: 'punch' } }])).not.toThrow();
    expect(check([{ at: 0, actor: 'a', do: 'pose', params: { name: 'kick' } }])).toThrow(/"a" não tem a pose "kick" \(poses: fly, punch\)/);
    expect(check([{ at: 0, actor: 'b', do: 'move', params: { id: 'jab' } }])).toThrow(/"b" não tem o golpe "jab" \(golpes: nenhum\)/);
    expect(check([{ at: 0, actor: 'a', do: 'play', params: { clip: 'spin' } }])).toThrow(/clipe "spin" não existe/);
    expect(check([{ at: 0, do: 'fx', params: { type: 'boom' } }])).toThrow(/efeito "boom" não existe/);
    expect(check([{ at: 0, do: 'spawnProp', params: { type: 'tree', at: [0, 0], size: [1, 1] } }])).toThrow(/tipo de prop "tree" não registrado/);
    expect(check([
      { at: 0, do: 'spawnProp', params: { type: 'door', at: [0, 0], size: [1, 1] } },
      { at: 1, do: 'prop', params: { id: 'door', action: 'lock' } },
    ])).toThrow(/"door" não tem a ação "lock" \(ações: open, close, remove\)/);
  });
});

describe('scriptSchema', () => {
  it('um ramo por comando, sem campos extras, gatilho at/after/on', () => {
    const schema = scriptSchema() as { $defs: { step: { oneOf: Record<string, unknown>[] } } };
    const variants = schema.$defs.step.oneOf;
    expect(variants.map((v) => (v['properties'] as { do: { const: string } }).do.const)).toEqual(Object.keys(COMMANDS));
    for (const v of variants) {
      expect(v['additionalProperties']).toBe(false);
      expect(v['oneOf']).toEqual([{ required: ['at'] }, { required: ['after'] }, { required: ['on'] }]);
    }
    const pose = variants.find((v) => (v['properties'] as { do: { const: string } }).do.const === 'pose')!;
    expect((pose['properties'] as { params: { required: string[] } }).params.required).toEqual(['name']);
  });
});

describe('API fluente', () => {
  it('gera o mesmo JSON escrito à mão (e o mesmo roteiro lido)', () => {
    const api = script({ title: 't', seed: 2 })
      .cast('a', { at: [0, 0] })
      .cast('b', { at: [400, 0], facing: -1 })
      .at(0).actor('a').moveTo([100, 0], 1).as('ida')
      .pose('punch')
      .then(0.2).move('jab', { target: 'b' })
      .on('hit:a->b').actor('b').parallel((p) => p.hover().delay(0.1).play('idle'))
      .actor(null).fx('impact', { size: 2 });
    const json = {
      title: 't',
      seed: 2,
      cast: { a: { at: [0, 0] }, b: { at: [400, 0], facing: -1 } },
      steps: [
        { at: 0, id: 'ida', actor: 'a', do: 'moveTo', params: { to: [100, 0], duration: 1 } },
        { at: 0, actor: 'a', do: 'pose', params: { name: 'punch' } },
        { after: '_1', delay: 0.2, actor: 'a', do: 'move', params: { id: 'jab', target: 'b' } },
        { on: 'hit:a->b', actor: 'b', do: 'parallel', params: { steps: [{ actor: 'b', do: 'hover' }, { delay: 0.1, actor: 'b', do: 'play', params: { clip: 'idle' } }] } },
        { on: 'hit:a->b', do: 'fx', params: { type: 'impact', size: 2 } },
      ],
    };
    // then() dá um id ao passo anterior (o pose) para encadear.
    json.steps[1] = { ...json.steps[1]!, id: '_1' } as (typeof json.steps)[number];
    expect(api.toJSON()).toEqual(json);
    expect(api.build()).toEqual(parseScript(json));
  });
});

describe('COMMAND_DOCS (autoria)', () => {
  it('descreve todos os comandos e parâmetros da tabela do player, e nada além', () => {
    expect(Object.keys(COMMAND_DOCS).sort()).toEqual(Object.keys(COMMANDS).sort());
    for (const [cmd, spec] of Object.entries(COMMANDS)) {
      expect(Object.keys(COMMAND_DOCS[cmd]!.params).sort(), cmd).toEqual(Object.keys(spec.params).sort());
      expect(COMMAND_DOCS[cmd]!.doc, cmd).not.toBe('');
    }
  });
});

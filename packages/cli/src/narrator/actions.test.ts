import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMoves } from '@perolanegra/sprite-fighter';
import { describe, expect, it } from 'vitest';
import { checkActions, readDeclaredActions } from './actions.js';
import { loadCast } from './assets.js';
import { buildCatalog } from './catalog.js';
import { validateScene } from './validate.js';

const ROOT = join(import.meta.dirname, '../../../..');

/** Elenco só com golpes (o checkActions não olha o personagem). */
const castWith = (run: unknown) =>
  new Map([['neo', { character: null as never, moves: parseMoves([{ id: 'truque', phases: [{ name: 'sumir', frames: 6, run }] }]) }]]);

function project(actions?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'sf-actions-'));
  if (actions !== undefined) writeFileSync(join(dir, 'sf.actions.json'), JSON.stringify(actions));
  return dir;
}

describe('sf.actions.json', () => {
  it('lê nomes, descrição e parâmetros; sem o arquivo, null; erro de formato com o campo', () => {
    expect(readDeclaredActions(project())).toBeNull();
    expect(readDeclaredActions(project([{ name: 'atras_a', description: 'some', params: { distance: 'px' } }]))).toEqual([
      { name: 'atras_a', description: 'some', params: { distance: 'px' } },
    ]);
    expect(() => readDeclaredActions(project([{ name: 'a' }, { name: 'a' }]))).toThrow(/sf.actions.json: \[1\]\.name: ação "a" repetida/);
  });

  it('declarada: aceita, confere os parâmetros e a simulação seca não quebra', () => {
    const declared = [{ name: 'acao_a', description: '', params: { distance: 'px' } }];
    expect(checkActions(castWith({ action: 'acao_a', params: { distance: 140 } }), declared)).toEqual({ errors: [], warnings: [] });
    const bad = checkActions(castWith({ action: 'acao_a', params: { lado: 'tras' } }), declared);
    expect(bad.errors[0]).toMatch(/não tem o parâmetro "lado" em sf.actions.json \(aceitos: distance\)/);
  });

  it('desconhecida: erro com o arquivo, aviso sem ele; embutida passa sempre', () => {
    expect(checkActions(castWith('acao_b'), [{ name: 'outra', description: '', params: {} }]).errors[0]).toMatch(/ação "acao_b" não é embutida nem está em sf.actions.json \(declaradas: outra\)/);
    const none = checkActions(castWith('acao_c'), null);
    expect(none.errors).toEqual([]);
    expect(none.warnings[0]).toMatch(/ação "acao_c" não é embutida e não há sf.actions.json/);
    expect(checkActions(castWith('teleport_behind'), [])).toEqual({ errors: [], warnings: [] });
  });

  it('validate: golpe com ação do app roda na simulação seca; o catálogo lista as declaradas', async () => {
    const cast = await loadCast(join(ROOT, 'assets'), ['neo']);
    cast.characters.get('neo')!.moves = parseMoves([{ id: 'truque', phases: [{ name: 'sumir', frames: 6, run: { action: 'acao_d', params: { distance: 90 } } }] }]);
    const scene = { cast: { neo: { at: [0, 600], scale: 0.4 } }, steps: [{ at: 0.1, actor: 'neo', do: 'move', params: { id: 'truque' } }] };
    const declared = [{ name: 'acao_d', description: 'some e volta', params: { distance: 'px' } }];
    const ok = await validateScene(scene, { cast, actions: declared });
    expect(ok.errors).toEqual([]);
    expect(ok.ok).toBe(true);
    const off = await validateScene(scene, { cast, actions: [] });
    expect(off.ok).toBe(false);
    const catalog = buildCatalog(join(ROOT, 'assets'), declared);
    expect(catalog.actions['acao_d']).toEqual({ builtin: false, description: 'some e volta', params: { distance: 'px' } });
    expect(catalog.actions['teleport_behind']).toMatchObject({ builtin: true });
  });
});

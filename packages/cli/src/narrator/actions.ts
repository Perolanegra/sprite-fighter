import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { actionNames, hasAction, registerAction, type CastMember } from '@perolanegra/sprite-fighter';
import { Reader } from '@perolanegra/sprite-fighter/authoring';

/**
 * Ações TS do app (`registerAction`), declaradas para as ferramentas em `sf.actions.json`, na raiz do
 * projeto que usa a lib. Em Node (validate, catálogo) elas não existem: o arquivo diz quais são e
 * que parâmetros aceitam.
 *
 *   [
 *     { "name": "teleport_front", "description": "some e reaparece na frente do alvo",
 *       "params": { "distance": "distância do alvo (px)" } }
 *   ]
 *
 * Num golpe: `"run": "teleport_front"` ou `"run": { "action": "teleport_front", "params": { "distance": 140 } }`.
 */
export const ACTIONS_FILE = 'sf.actions.json';

export interface DeclaredAction {
  name: string;
  description: string;
  /** Parâmetro → descrição. */
  params: Record<string, string>;
}

/** As embutidas do core (registradas antes de qualquer ação vazia do narrador). */
const BUILTIN = new Set(actionNames());
export const isBuiltinAction = (name: string) => BUILTIN.has(name);

/** Lê `<root>/sf.actions.json`; null = não há arquivo. Erro de formato com o campo. */
export function readDeclaredActions(root: string): DeclaredAction[] | null {
  const file = join(root, ACTIONS_FILE);
  if (!existsSync(file)) return null;
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${ACTIONS_FILE}: JSON inválido (${(e as Error).message})`);
  }
  const r = new Reader(ACTIONS_FILE, json);
  const seen = new Set<string>();
  return r.array().map((a) => {
    const name = a.at('name').string();
    if (!/^[A-Za-z0-9_]+$/.test(name)) a.at('name').fail('use só letras, números e _');
    if (seen.has(name)) a.at('name').fail(`ação "${name}" repetida`);
    seen.add(name);
    const p = a.at('params');
    const params = p.present ? Object.fromEntries(Object.keys(p.object()).map((k) => [k, p.at(k).optString() ?? ''])) : {};
    return { name, description: a.at('description').optString() ?? '', params };
  });
}

/**
 * Confere as ações citadas pelos golpes do elenco (`run`) contra as embutidas e as declaradas:
 *  - declarada: confere os parâmetros e registra uma ação vazia (a simulação seca não a executa);
 *  - desconhecida com o arquivo: erro (o arquivo é a lista completa);
 *  - desconhecida sem o arquivo: aviso, e também uma ação vazia para a simulação seguir.
 */
export function checkActions(characters: Map<string, CastMember>, declared: DeclaredAction[] | null): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const byName = new Map((declared ?? []).map((a) => [a.name, a]));
  const reported = new Set<string>();
  for (const [char, m] of characters)
    for (const move of m.moves?.values() ?? [])
      move.phases.forEach((ph) => {
        if (!ph.run) return;
        const where = `golpe "${move.id}" de "${char}", fase "${ph.name}"`;
        const decl = byName.get(ph.run);
        if (isBuiltinAction(ph.run)) return;
        if (decl) {
          for (const k of Object.keys(ph.runParams))
            if (!(k in decl.params)) errors.push(`${where}: a ação "${ph.run}" não tem o parâmetro "${k}" em ${ACTIONS_FILE} (aceitos: ${Object.keys(decl.params).join(', ') || 'nenhum'})`);
        } else if (declared) {
          errors.push(`${where}: ação "${ph.run}" não é embutida nem está em ${ACTIONS_FILE} (declaradas: ${[...byName.keys()].join(', ') || 'nenhuma'})`);
        } else if (!reported.has(ph.run)) {
          reported.add(ph.run);
          warnings.push(`${where}: ação "${ph.run}" não é embutida e não há ${ACTIONS_FILE} na raiz do projeto: a simulação seca a ignora (declare-a no arquivo para conferir nome e parâmetros)`);
        }
        // A simulação seca não roda o código do app: no lugar dela, uma ação que não faz nada.
        if (!hasAction(ph.run)) registerAction(ph.run, () => {});
      });
  return { errors, warnings };
}

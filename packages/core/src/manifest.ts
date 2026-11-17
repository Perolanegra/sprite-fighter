import type { ProvisionalSpec } from './image-pose.js';
import { Reader } from './validate.js';

/**
 * Manifesto do personagem (`assets/skins/<id>.json`): o índice das poses-imagem, com a descrição
 * visual do personagem e, por pose, uma descrição e tags (usadas pelo narrador e pelos prompts de
 * imagem). Regra do projeto: a pasta das poses (`dir`) termina no id do personagem.
 *
 *   { "default": "fly", "dir": "poses/<coleção>/<id>",
 *     "character": { "name": "…", "description": "…", "style": "…", "styleRefs": ["poses/<coleção>/<id>/src/fly.png"] },
 *     "poses": [ { "name": "fly", "description": "…", "tags": ["voo"],
 *                  "variants": [ { "name": "angry", "kind": "expression", "description": "…", "tags": ["raiva"] } ] } ],
 *     "provisional": { "dodge": { "from": "fly", "rotate": -24, "description": "…", "tags": ["esquiva"] } } }
 *
 * Formato antigo aceito: `poses` como lista de nomes e sem `character`.
 *
 * Variantes (`<dir>/<pose>@<variante>.webp`): a mesma pose com outra imagem (expressão, mão), no
 * mesmo enquadramento; reusam o esqueleto da pose. `kind` diz qual comando do roteiro as escolhe.
 */

/** Tipos de variante: o comando do roteiro com o mesmo nome escolhe entre elas. */
export const VARIANT_KINDS = ['expression', 'hand'] as const;
export type VariantKind = (typeof VARIANT_KINDS)[number];

export interface VariantMeta {
  name: string;
  kind: VariantKind;
  description: string;
  tags: string[];
}

export interface PoseMeta {
  name: string;
  /** O que o corpo faz, em uma frase (vazia = ainda não escrita). */
  description: string;
  tags: string[];
  /** Variantes de textura desta pose. */
  variants: VariantMeta[];
}

export interface CharacterInfo {
  name: string;
  /** Aparência e roupa (vai em todo prompt de imagem). */
  description: string;
  /** Traço, sombreamento, cores. */
  style: string;
  /** Imagens de referência de estilo, relativas a assets/. */
  styleRefs: string[];
}

export interface CharacterManifest {
  id: string;
  default: string;
  dir: string;
  character: CharacterInfo | null;
  poses: PoseMeta[];
  provisional: Record<string, ProvisionalSpec & { description: string; tags: string[] }>;
}

function meta(r: Reader, name: string): { description: string; tags: string[] } {
  const tags = r.at('tags').present ? r.at('tags').array().map((t) => t.string()) : [];
  tags.forEach((t, i) => {
    if (t !== t.toLowerCase()) r.at('tags').at(i).fail(`tag "${t}" precisa ser minúscula`);
  });
  const description = r.at('description').present ? (r.at('description').value as string) : '';
  if (typeof description !== 'string') r.at('description').fail(`descrição da pose "${name}" precisa ser texto`);
  return { description: description.trim(), tags };
}

/** Lê e valida o manifesto. `id` = id do personagem (a pasta precisa terminar nele). */
export function parseManifest(json: unknown, id: string, source = `manifesto ${id}`): CharacterManifest {
  const r = new Reader(source, json);
  r.object();
  const poses = r.at('poses').array().map((p): PoseMeta => {
    if (typeof p.value === 'string') return { name: p.string(), description: '', tags: [], variants: [] };
    const name = p.at('name').string();
    const variants = p.at('variants').present
      ? p.at('variants').array().map((v): VariantMeta => {
          const vn = v.at('name').string();
          // "@2x" é a textura de tela densa e "none" volta à imagem da pose: não podem ser nome de variante.
          if (!/^[a-z0-9_]+$/.test(vn) || /^\d+x$/.test(vn) || vn === 'none') v.at('name').fail(`nome de variante inválido "${vn}" (letras minúsculas, números e _; não "2x" nem "none")`);
          return { name: vn, kind: v.at('kind').oneOf(VARIANT_KINDS), ...meta(v, `${name}@${vn}`) };
        })
      : [];
    const seen = new Set<string>();
    variants.forEach((v, i) => {
      if (seen.has(v.name)) p.at('variants').at(i).fail(`variante "${v.name}" repetida em "${name}"`);
      seen.add(v.name);
    });
    return { name, ...meta(p, name), variants };
  });
  const names = new Set<string>();
  poses.forEach((p, i) => {
    if (names.has(p.name)) r.at('poses').at(i).fail(`pose "${p.name}" repetida`);
    names.add(p.name);
  });
  const def = r.at('default').string();
  if (!names.has(def)) r.at('default').fail(`"${def}" não está em poses`);
  const dir = r.at('dir').string().replace(/\/$/, '');
  // Regra do projeto: a pasta de cada personagem tem o mesmo nome do id.
  if (dir.split('/').pop() !== id) r.at('dir').fail(`a pasta das poses precisa se chamar "${id}" (o id do personagem); veio "${dir}"`);

  const provisional: CharacterManifest['provisional'] = {};
  const pr = r.at('provisional');
  if (pr.present)
    for (const name of Object.keys(pr.object())) {
      const v = pr.at(name);
      const from = v.at('from').string();
      if (!names.has(from)) v.at('from').fail(`"${from}" não está em poses`);
      if (names.has(name)) v.fail(`"${name}" já tem imagem (tire de "provisional")`);
      provisional[name] = {
        from,
        rotate: v.at('rotate').optNumber(0),
        sx: v.at('sx').optNumber(1),
        sy: v.at('sy').optNumber(1),
        dx: v.at('dx').optNumber(0),
        dy: v.at('dy').optNumber(0),
        ...meta(v, name),
      };
    }

  const c = r.at('character');
  const character = c.present
    ? {
        name: c.at('name').string(),
        description: c.at('description').string(),
        style: c.at('style').optString() ?? '',
        styleRefs: c.at('styleRefs').present ? c.at('styleRefs').array().map((s) => s.string()) : [],
      }
    : null;
  return { id, default: def, dir, character, poses, provisional };
}

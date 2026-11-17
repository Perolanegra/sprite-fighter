import type { CharacterManifest } from '@perolanegra/sprite-fighter';
import { inAssets, SF } from '../paths.js';

/** Regras fixas de toda imagem de pose (guia "novo personagem"). */
export const IMAGE_RULES = [
  'o mesmo personagem das imagens de referência: mesmo rosto, cabelo, roupa, cores e proporções',
  'corpo inteiro, de perfil virado para a direita, figura centralizada com margem em volta',
  'fundo branco liso (#FFFFFF), sem cenário, sem sombra no chão, sem texto, sem moldura',
  'mesmo traço, contorno e sombreamento das referências',
];

export interface ImagePrompt {
  pose: string;
  /** Texto para colar na IA de imagem. */
  prompt: string;
  /** Imagens para anexar (relativas a assets/): referências de estilo + a pose de partida. */
  attach: string[];
  /** Comandos para trazer a imagem pronta para o projeto. */
  next: string[];
}

/** Diz se um arquivo existe na pasta de assets (caminho relativo a ela). Padrão: sempre. */
export type AssetExists = (rel: string) => boolean;

/**
 * A imagem de uma pose para anexar: a fonte (`<dir>/src/<pose>.png`) ou, se ela não existir (ex.: um app
 * que importou só as poses prontas), a `.webp` da pose, que é a mesma figura já recortada.
 */
export function poseRef(m: CharacterManifest, pose: string, exists: AssetExists): string {
  const src = `${m.dir}/src/${pose}.png`;
  return exists(src) ? src : `${m.dir}/${pose}.webp`;
}

/** Referências de estilo: uma fonte de pose (`<dir>/src/<pose>.png`) que não existe vira a `.webp` dela (sem repetir). */
function styleRefs(m: CharacterManifest, exists: AssetExists): string[] {
  const prefix = `${m.dir}/src/`;
  const asPose = (r: string) => (r.startsWith(prefix) && r.endsWith('.png') && !exists(r) ? poseRef(m, r.slice(prefix.length, -4), exists) : r);
  return [...new Set((m.character?.styleRefs ?? []).map(asPose))];
}

/**
 * Prompt de imagem de uma pose (provisória ou nova), montado só a partir do manifesto: descrição e
 * estilo do personagem, descrição da pose e regras fixas. Determinístico (igual em toda execução).
 */
export function imagePrompt(m: CharacterManifest, pose: string, description?: string, tags?: string[], exists: AssetExists = () => true): ImagePrompt {
  const prov = m.provisional[pose];
  const what = (description ?? prov?.description ?? m.poses.find((p) => p.name === pose)?.description ?? '').trim();
  if (!what) throw new Error(`pose "${pose}" de ${m.id} sem descrição: escreva "description" no manifesto`);
  const c = m.character;
  const lines = [
    `Personagem: ${c ? `${c.name}, ${c.description}` : m.id}.`,
    `Pose: ${what}.`,
    ...(c?.style ? [`Estilo: ${c.style}.`] : []),
    ...IMAGE_RULES.map((r) => `- ${r}.`),
  ];
  // A pose de partida (a que a provisória imita) ajuda no enquadramento e na escala.
  const from = prov?.from;
  const attach = styleRefs(m, exists);
  const fromRef = from ? poseRef(m, from, exists) : null;
  if (fromRef && !attach.includes(fromRef)) attach.push(fromRef);
  const file = `${m.dir}/src/${pose}.png`;
  const t = tags ?? prov?.tags ?? m.poses.find((p) => p.name === pose)?.tags ?? [];
  const q = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
  return {
    pose,
    prompt: lines.join('\n'),
    attach,
    next: [
      `salve a imagem em ${inAssets(file)}`,
      `${SF} pose:add --char ${m.id} --pose ${pose} --src ${inAssets(file)} --description ${q(what)}${t.length ? ` --tags ${q(t.join(','))}` : ''}`,
      `ajuste o esqueleto e a medida da cabeça (a escala acompanha) no Pose Lab e salve: npx sf lab → http://localhost:5180/?scene=poselab&mode=image&char=${m.id}&pose=${pose}`,
    ],
  };
}

/**
 * Prompt de imagem de uma variante (`<pose>@<variante>`): a mesma imagem da pose, no mesmo
 * enquadramento, mudando só o que a variante descreve (expressão, mão). Anexa a imagem da pose base.
 */
export function variantPrompt(
  m: CharacterManifest,
  pose: string,
  variant: string,
  kind: 'expression' | 'hand',
  description: string,
  tags: string[] = [],
  exists: AssetExists = () => true,
): ImagePrompt {
  const base = m.poses.find((p) => p.name === pose);
  if (!base) throw new Error(`pose "${pose}" de ${m.id} não tem imagem: variantes só em poses com imagem`);
  const c = m.character;
  const what = kind === 'expression' ? 'a expressão do rosto' : 'a mão (e o que ela segura)';
  const lines = [
    `Personagem: ${c ? `${c.name}, ${c.description}` : m.id}.`,
    `Edite a imagem anexada (${pose}: ${base.description || pose}), mudando só ${what}: ${description}.`,
    ...(c?.style ? [`Estilo: ${c.style}.`] : []),
    '- mesma pose, mesmo tamanho de tela e mesmo enquadramento da imagem anexada: a figura não pode mudar de lugar nem de tamanho.',
    ...IMAGE_RULES.slice(2).map((r) => `- ${r}.`),
  ];
  const src = poseRef(m, pose, exists);
  const file = `${m.dir}/src/${pose}@${variant}.png`;
  const q = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
  return {
    pose: `${pose}@${variant}`,
    prompt: lines.join('\n'),
    attach: [src, ...styleRefs(m, exists).filter((r) => r !== src)],
    next: [
      `salve a imagem em ${inAssets(file)} (mesmo tamanho de ${inAssets(src)})`,
      `${SF} pose:add --char ${m.id} --pose ${pose} --variant ${variant} --kind ${kind} --src ${inAssets(file)} --description ${q(description)}${tags.length ? ` --tags ${q(tags.join(','))}` : ''}`,
      `confira o alinhamento: ?scene=variants&char=${m.id}`,
    ],
  };
}

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { VARIANT_KINDS, VARIANT_SILHOUETTE_WARN, parseManifest, silhouetteDiff, type VariantKind } from '@perolanegra/sprite-fighter';
import { applyMask, foregroundMask } from './background.js';
import type { RgbaImage } from './image.js';
import { WEBP, cutFigure, formatManifest, kb, readManifest, runNormalize, runPose } from './pose.js';
import { assetsDir, inAssets, SF } from '../paths.js';

/**
 *   sf pose:add --char <id> --pose <nome> --src <png> [--rect x,y,w,h] --description "…" --tags a,b [--replace]
 *                       [--dir poses/<coleção>/<id> --skeleton <outro-id>]   (as duas: primeira pose de um personagem novo)
 *   sf pose:add --char <id> --pose <pose> --variant <nome> --kind expression|hand --src <png>
 *                       [--description "…"] [--tags a,b] [--replace]
 *
 * Pose: recorta, converte, cria o esqueleto inicial, registra no manifesto (sai de "provisional") e
 * normaliza a escala. Variante: a mesma pose com outra imagem (expressão, mão), que reusa
 * esqueleto, malha e pesos da pose; sai no mesmo enquadramento da pose e é conferida contra ela.
 */
export async function runPoseAdd(argv: string[], root: string): Promise<void> {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const char = get('--char'), pose = get('--pose'), src = get('--src'), variant = get('--variant');
  if (!char || !pose || !src) throw new Error('uso: sf pose:add --char <id> --pose <nome> --src <png> [--variant <nome> --kind expression|hand] [--description "…"] [--tags a,b] [--replace]');
  const srcFile = resolve(root, src);
  if (!existsSync(srcFile)) throw new Error(`imagem não encontrada: ${src}`);
  if (variant) return addVariant(root, { char, pose, variant, srcFile, kind: get('--kind'), description: get('--description'), tags: get('--tags'), replace: argv.includes('--replace') });

  // Personagem novo: o manifesto nasce no runPose (com --dir).
  const before = existsSync(join(assetsDir(root), 'skins', `${char}.json`)) ? await readManifest(root, char) : null;
  // Pose já listada no manifesto mas ainda sem imagem (escrita antes de gerar a imagem): não precisa de --replace.
  const hasImage = before?.poses.some((p) => p.name === pose) && existsSync(join(assetsDir(root), before.dir, `${pose}.webp`));
  if (hasImage && !argv.includes('--replace')) throw new Error(`a pose "${pose}" de ${char} já existe (use --replace para trocar a imagem)`);
  await runPose([srcFile, '--char', char, '--pose', pose, ...pass(argv, ['--rect', '--description', '--tags', '--dir', '--skeleton'])], root);
  const m = await readManifest(root, char);
  // Normaliza a escala pela pose base (precisa do esqueleto dela, com a medida da cabeça).
  const baseSkin = join(assetsDir(root), m.dir, `${m.default}.skin.json`);
  if (existsSync(baseSkin) && (JSON.parse(await readFile(baseSkin, 'utf8')) as { measure?: unknown }).measure) await runNormalize(['--char', char], root);
  else console.log(`  escala não normalizada: falta o esqueleto da pose base "${m.default}" com a medida da cabeça (Pose Lab)`);
  const demo = 'http://localhost:5180/';
  console.log(`\nConferir (com npx sf lab):\n  ${demo}?scene=poselab&mode=image&char=${char}&pose=${pose}   esqueleto e medida da cabeça\n  ${demo}?scene=skin&char=${char}&mode=strip   todas as poses na mesma escala`);
}

const pass = (argv: string[], flags: string[]) => flags.flatMap((f) => (argv.includes(f) ? [f, argv[argv.indexOf(f) + 1]!] : []));

async function rgbaOf(s: Sharp): Promise<RgbaImage> {
  const { data, info } = await s.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

const alphaOf = (img: RgbaImage) => {
  const a = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0; i < a.length; i++) a[i] = img.data[i * 4 + 3]!;
  return a;
};

type ManifestJson = { poses: (string | { name: string; variants?: { name: string; kind: string; description?: string; tags?: string[] }[] })[]; [k: string]: unknown };

async function addVariant(
  root: string,
  o: { char: string; pose: string; variant: string; srcFile: string; kind?: string; description?: string; tags?: string; replace: boolean },
): Promise<void> {
  const { char, pose, variant } = o;
  if (!/^[a-z0-9_]+$/.test(variant) || /^\d+x$/.test(variant) || variant === 'none') throw new Error(`nome de variante inválido "${variant}" (letras minúsculas, números e _; não "2x" nem "none")`);
  const m = await readManifest(root, char);
  const entry = m.poses.find((p) => p.name === pose);
  if (!entry) throw new Error(`${char} não tem a pose "${pose}" com imagem${m.provisional[pose] ? ' (é provisória: variantes só em poses com imagem)' : ''}`);
  const old = entry.variants.find((v) => v.name === variant);
  if (old && !o.replace) throw new Error(`${pose}@${variant} já existe (use --replace para trocar a imagem)`);
  const kind = (o.kind ?? old?.kind) as VariantKind | undefined;
  if (!kind || !VARIANT_KINDS.includes(kind)) throw new Error(`--kind ${VARIANT_KINDS.join('|')} (qual comando do roteiro escolhe esta variante)`);

  const dir = join(assetsDir(root), m.dir);
  const baseFile = join(dir, `${pose}.webp`);
  if (!existsSync(baseFile)) throw new Error(`falta a imagem da pose: ${inAssets(`${m.dir}/${pose}.webp`)}`);
  const base = await rgbaOf(sharp(baseFile));
  const base2x = existsSync(join(dir, `${pose}@2x.webp`)) ? await sharp(join(dir, `${pose}@2x.webp`)).metadata() : null;
  const srcMeta = await sharp(o.srcFile).metadata();
  const baseSrc = join(dir, 'src', `${pose}.png`);

  // Mesmo enquadramento da pose: a variante é recortada com a caixa da figura da base.
  let out1: Sharp, out2: Sharp | null = null;
  if (srcMeta.width === base.width && srcMeta.height === base.height) {
    // Já no tamanho final: só tira o fundo.
    const img = await rgbaOf(sharp(o.srcFile));
    const cut = applyMask(img, foregroundMask(img));
    out1 = sharp(Buffer.from(cut.data.buffer), { raw: { width: img.width, height: img.height, channels: 4 } });
    if (base2x) console.log('  aviso: a fonte está no tamanho 1x; a variante fica sem @2x (a textura densa usa a 1x)');
  } else if (existsSync(baseSrc)) {
    const ref = await cutFigure(baseSrc);
    if (ref.w1 !== base.width || ref.h1 !== base.height)
      throw new Error(`não consegui refazer o recorte da pose "${pose}" a partir de src/${pose}.png (${ref.w1}×${ref.h1} ≠ ${base.width}×${base.height}); entregue a variante já no tamanho ${base.width}×${base.height}`);
    if (srcMeta.width !== ref.width || srcMeta.height !== ref.height)
      throw new Error(`a variante precisa ter o tamanho da imagem de origem da pose (src/${pose}.png, ${ref.width}×${ref.height}) ou o da pose pronta (${base.width}×${base.height}); veio ${srcMeta.width}×${srcMeta.height}`);
    const fig = await cutFigure(o.srcFile);
    out1 = fig.raw(ref.box).resize(ref.w1, ref.h1, { kernel: 'lanczos3' });
    if (base2x && ref.w2) out2 = fig.raw(ref.box).resize(ref.w2, ref.h2, { kernel: 'lanczos3' });
  } else throw new Error(`sem src/${pose}.png para refazer o enquadramento: entregue a variante no tamanho da pose pronta (${base.width}×${base.height})`);

  // Confere contra a base: mesmo tamanho (garantido acima) e silhueta parecida.
  const v = await rgbaOf(out1.clone());
  const { diff, shift } = silhouetteDiff(alphaOf(base), alphaOf(v), base.width);
  const pct = (diff * 100).toFixed(1);
  console.log(`${char}/${pose}@${variant}: ${v.width}×${v.height} · silhueta ${pct} % diferente da base · centro deslocado ${shift.x.toFixed(1)}, ${shift.y.toFixed(1)} px`);
  if (diff > VARIANT_SILHOUETTE_WARN)
    console.log(`  AVISO: a silhueta muda mais de ${VARIANT_SILHOUETTE_WARN * 100} %: confira o alinhamento (a malha e os pesos são os da pose "${pose}")`);

  const file1 = join(dir, `${pose}@${variant}.webp`);
  await out1.webp(WEBP).toFile(file1);
  let size2 = '';
  if (out2) {
    const file2 = join(dir, `${pose}@${variant}@2x.webp`);
    await out2.webp(WEBP).toFile(file2);
    size2 = ` + @2x (${await kb(file2)} KB)`;
  }
  const size1 = await kb(file1);
  console.log(`  ${pose}@${variant}.webp (${size1} KB${size1 > 200 ? ' — ACIMA da meta de 200 KB' : ''})${size2}`);
  // A fonte fica junto das outras (src/<pose>@<variante>.png).
  const keep = join(dir, 'src', `${pose}@${variant}.png`);
  if (resolve(o.srcFile) !== keep) {
    await mkdir(join(dir, 'src'), { recursive: true });
    await copyFile(o.srcFile, keep);
  }

  const file = join(assetsDir(root), 'skins', `${char}.json`);
  const json = JSON.parse(await readFile(file, 'utf8')) as ManifestJson;
  json.poses = json.poses.map((p) => (typeof p === 'string' ? { name: p } : p));
  const p = json.poses.find((x) => typeof x !== 'string' && x.name === pose) as Exclude<ManifestJson['poses'][number], string>;
  const list = (p.variants ??= []);
  const description = o.description ?? old?.description ?? '';
  const tags = o.tags !== undefined ? o.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) : (old?.tags ?? []);
  const item = { name: variant, kind, description, tags };
  const at = list.findIndex((x) => x.name === variant);
  if (at >= 0) list[at] = item;
  else list.push(item);
  parseManifest(json, char); // valida antes de gravar
  await writeFile(file, formatManifest(json));
  if (!description) console.log(`  aviso: variante sem descrição (use --description)`);
  console.log(`\nNo roteiro: { "actor": "${char}", "do": "${kind}", "params": { "name": "${variant}" } }\nConferir: ?scene=variants&char=${char}`);
}

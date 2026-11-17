/**
 * sf-atlas pose: recorta uma pose-chave (a figura inteira) de uma folha de personagem.
 *
 *   npm run atlas -- pose assets/reference/<id>-draft.png --char <id> --pose fly --rect 690,20,830,390
 *
 * Saída: assets/<pose>/<char>.png (fundo branco removido, só a figura) e a pose acrescentada ao
 * índice assets/skins/<char>.json. Dentro do retângulo fica o maior componente e os que encostam
 * na caixa dele (mão ou gravata soltas); o resto (pedaços de outros desenhos) sai.
 */
import { existsSync } from 'node:fs';
import { parseManifest, type CharacterManifest } from 'sprite-fighter';
import { headHeight, normalizedScale } from './normalize.js';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { applyMask, foregroundMask, removeEnclosedHoles } from './background.js';
import { connectedComponents } from './components.js';
import type { Rect, RgbaImage } from './image.js';

const MARGIN = 4;

const touches = (a: Rect, b: Rect, pad: number) =>
  a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;

/**
 * Figura principal do recorte: o maior componente + os que encostam nele (pura, testada).
 * Pedaços que tocam a borda do retângulo foram cortados de outro desenho: ficam de fora.
 */
export function pickFigure(mask: Uint8Array, w: number, h: number, minArea = 400): { keep: Uint8Array; box: Rect } {
  const { labels, parts: all } = connectedComponents(mask, w, h, minArea);
  if (!all.length) throw new Error('nenhuma figura no retângulo');
  const main = all.reduce((a, b) => (b.area > a.area ? b : a));
  const onBorder = (r: Rect) => r.x <= 0 || r.y <= 0 || r.x + r.w >= w || r.y + r.h >= h;
  if (onBorder(main.bbox)) console.warn('aviso: a figura encosta na borda do retângulo (pode estar cortada); aumente o --rect');
  const parts = all.filter((p) => p === main || !onBorder(p.bbox));
  const kept = new Set([main.id]);
  let box = { ...main.bbox };
  // Repete até estabilizar: um pedaço pode encostar em outro que encosta na figura.
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of parts)
      if (!kept.has(p.id) && touches(p.bbox, box, 6)) {
        kept.add(p.id);
        const x0 = Math.min(box.x, p.bbox.x), y0 = Math.min(box.y, p.bbox.y);
        box = { x: x0, y: y0, w: Math.max(box.x + box.w, p.bbox.x + p.bbox.w) - x0, h: Math.max(box.y + box.h, p.bbox.y + p.bbox.h) - y0 };
        changed = true;
      }
  }
  const keep = new Uint8Array(w * h);
  for (let i = 0; i < keep.length; i++) if (kept.has(labels[i]!)) keep[i] = 1;
  return { keep, box };
}

/** Lado maior da versão 1x (a @2x vai até o dobro, se a fonte tiver resolução pra isso). */
const MAX_1X = 1024;
export const WEBP = { quality: 86, alphaQuality: 90, effort: 5 } as const;

export const kb = async (f: string) => Math.round((await stat(f)).size / 1024);

/** Figura recortada de uma imagem: a caixa na fonte (com margem), os tamanhos 1x/@2x e os pixels. */
export interface CutFigure {
  /** Tamanho da fonte (só o --rect). */
  width: number;
  height: number;
  /** Caixa da figura com margem, em px do --rect. */
  box: { x: number; y: number; w: number; h: number };
  w1: number;
  h1: number;
  /** @2x (0 = não tem: a fonte não tem mais resolução que a 1x). */
  w2: number;
  h2: number;
  holes: number;
  /** A figura (fundo transparente), recortada em `box` (ou em `at`, se dado). */
  raw(at?: CutFigure['box']): Sharp;
}

/**
 * Recorta a figura principal (fundo branco e vãos fechados fora) e calcula os tamanhos 1x/@2x. O
 * mesmo cálculo serve às variantes: com a caixa da base (`raw(base.box)`) a variante sai no mesmo
 * enquadramento.
 */
export async function cutFigure(file: string, rectArg?: string): Promise<CutFigure> {
  const meta = await sharp(file).metadata();
  const rect = rectArg?.split(',').map(Number) ?? [0, 0, meta.width!, meta.height!];
  if (rect.length !== 4 || rect.some((n) => !Number.isFinite(n))) throw new Error('--rect x,y,w,h');
  const [rx, ry, rw, rh] = rect as [number, number, number, number];
  const { data, info } = await sharp(file).extract({ left: rx, top: ry, width: rw, height: rh }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const img: RgbaImage = { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
  const mask = foregroundMask(img);
  const { keep, box } = pickFigure(mask, img.width, img.height);
  const holes = removeEnclosedHoles(img, keep);
  const cut = applyMask(img, keep);
  const x0 = Math.max(0, box.x - MARGIN), y0 = Math.max(0, box.y - MARGIN);
  const x1 = Math.min(img.width, box.x + box.w + MARGIN), y1 = Math.min(img.height, box.y + box.h + MARGIN);
  const fw = x1 - x0, fh = y1 - y0;
  const k1 = Math.min(1, MAX_1X / Math.max(fw, fh));
  const k2 = Math.min(1, (2 * MAX_1X) / Math.max(fw, fh));
  const own = { x: x0, y: y0, w: fw, h: fh };
  return {
    width: img.width,
    height: img.height,
    box: own,
    w1: Math.round(fw * k1),
    h1: Math.round(fh * k1),
    w2: k1 < 0.95 ? Math.round(fw * k2) : 0,
    h2: k1 < 0.95 ? Math.round(fh * k2) : 0,
    holes,
    raw: (at = own) =>
      sharp(Buffer.from(cut.data.buffer, cut.data.byteOffset, cut.data.length), { raw: { width: img.width, height: img.height, channels: 4 } }).extract({
        left: at.x,
        top: at.y,
        width: at.w,
        height: at.h,
      }),
  };
}

/** Pasta de assets: `assets/` da raiz, ou `SF_ASSETS` (a mesma variável da demo e do narrador; ex.: uma cópia para testes). */
export const assetsDir = (root: string) => resolve(root, process.env['SF_ASSETS'] ?? 'assets');

/** Manifesto como está no disco (o formato é validado por `parseManifest` do core). */
type ManifestJson = {
  default: string;
  dir: string;
  poses: (string | { name: string; description?: string; tags?: string[] })[];
  provisional?: Record<string, { description?: string; tags?: string[] }>;
  [k: string]: unknown;
};

/** Lê o manifesto validado (`assets/skins/<id>.json`). */
export async function readManifest(root: string, char: string): Promise<CharacterManifest> {
  const file = join(assetsDir(root), 'skins', `${char}.json`);
  if (!existsSync(file)) throw new Error(`manifesto não encontrado: assets/skins/${char}.json`);
  return parseManifest(JSON.parse(await readFile(file, 'utf8')), char);
}

/**
 *   npm run atlas -- pose <imagem.png> --char <id> --pose <nome> [--rect x,y,w,h] [--dir poses/<coleção>/<id>]
 *                         [--description "…"] [--tags a,b] [--skeleton <outro-id>]
 *
 * Recorta a figura (fundo branco e vãos fechados fora) e grava em assets/<dir>/:
 *   <pose>.webp (lado maior ≤ 1024), <pose>@2x.webp (≤ 2048, se a fonte for maior que a 1x)
 * e registra a pose no manifesto assets/skins/<id>.json (com descrição e tags). Se a pose era
 * provisória, sai de "provisional" (herda a descrição e as tags, se não vierem outras).
 * As coordenadas do esqueleto ficam na 1x. Esqueleto inicial (só se ainda não houver skin.json): o da
 * pose base do personagem ou, com `--skeleton <outro-id>` (primeira pose de um personagem novo), o
 * da pose base de outro personagem, com a cabeça do mesmo tamanho no mundo.
 */
export async function runPose(argv: string[], root: string): Promise<void> {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const sheet = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  const char = get('--char');
  const pose = get('--pose');
  if (!sheet || !char || !pose) {
    console.error('uso: sf-atlas pose <imagem.png> --char <nome> --pose <pose> [--rect x,y,w,h] [--dir poses/code-call/<pasta>]');
    process.exit(1);
  }
  if (!/^[a-z0-9_]+$/.test(pose) || !/^[a-z0-9_]+$/.test(char)) throw new Error('char e pose: só letras minúsculas, números e _');
  const indexFile = join(assetsDir(root), 'skins', `${char}.json`);
  const index: ManifestJson | null = existsSync(indexFile) ? JSON.parse(await readFile(indexFile, 'utf8')) : null;
  const dir = (get('--dir') ?? index?.dir)?.replace(/\/$/, '');
  if (!dir) throw new Error(`informe --dir (ex.: poses/code-call/${char}) na primeira pose de ${char}`);
  // Regra do projeto: a pasta de cada personagem tem o mesmo nome do id.
  if (dir.split('/').pop() !== char) throw new Error(`a pasta das poses precisa se chamar "${char}" (o id do personagem); veio "${dir}"`);

  const fig = await cutFigure(resolve(root, sheet), get('--rect'));
  const { w1, h1, holes } = fig;
  const outDir = join(assetsDir(root), dir);
  await mkdir(outDir, { recursive: true });
  const file1 = join(outDir, `${pose}.webp`);
  await fig.raw().resize(w1, h1, { kernel: 'lanczos3' }).webp(WEBP).toFile(file1);
  // @2x só se a fonte tiver mais resolução que a 1x (senão seria só ampliar).
  let file2: string | null = null;
  if (fig.w2) {
    file2 = join(outDir, `${pose}@2x.webp`);
    await fig.raw().resize(fig.w2, fig.h2, { kernel: 'lanczos3' }).webp(WEBP).toFile(file2);
  }
  const size1 = await kb(file1);
  await mkdir(join(assetsDir(root), 'skins'), { recursive: true });
  const next: ManifestJson = index ?? { default: pose, dir, poses: [] };
  next.dir = dir;
  // Poses como objetos (formato novo); a provisória de mesmo nome vira pose de verdade.
  const was = next.provisional?.[pose];
  if (was) {
    delete next.provisional![pose];
    console.log(`  "${pose}" deixa de ser provisória (agora tem imagem)`);
  }
  const entries = next.poses.map((p) => (typeof p === 'string' ? { name: p, description: '', tags: [] as string[] } : p));
  let entry = entries.find((e) => e.name === pose);
  if (!entry) entries.push((entry = { name: pose, description: was?.description ?? '', tags: was?.tags ?? [] }));
  const description = get('--description'), tags = get('--tags');
  if (description !== undefined) entry.description = description;
  if (tags !== undefined) entry.tags = tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  next.poses = entries;
  parseManifest(next, char); // valida antes de gravar
  await writeFile(indexFile, formatManifest(next));
  if (!entry.description) console.log(`  aviso: pose "${pose}" sem descrição (use --description)`);
  if (!next.character)
    console.log(
      `  manifesto sem "character": escreva em assets/skins/${char}.json o nome, a descrição visual, o estilo e as imagens de referência\n` +
        `  (vão em todo prompt de imagem do pose:list e do narrador)`,
    );
  // Esqueleto inicial: o da pose base deste personagem ou, com --skeleton <id>, o da pose base de outro.
  const from = get('--skeleton');
  let source = { dir, pose: next.default };
  if (from) {
    const other = await readManifest(root, from);
    source = { dir: other.dir, pose: other.default };
  }
  await initialSkeleton(root, char, source, dir, pose, w1, h1, file2 !== null);
  console.log(
    `${char}/${pose}: ${w1}×${h1} (${size1} KB${size1 > 200 ? ' — ACIMA da meta de 200 KB' : ''})` +
      (file2 ? ` + @2x (${await kb(file2)} KB)` : '') +
      ` · ${holes} vão(s) fechado(s) removido(s)`,
  );
}

/**
 *   npm run atlas -- normalize --char <id>
 *
 * Iguala a altura da cabeça de todas as poses à da pose padrão (fly): grava em cada <pose>.skin.json
 * `scale` = scale_fly × cabeça_fly / cabeça_pose. Precisa de `measure.headTop`/`measure.chin`.
 */
export async function runNormalize(argv: string[], root: string): Promise<void> {
  const i = argv.indexOf('--char');
  const char = i >= 0 ? argv[i + 1] : undefined;
  if (!char) throw new Error('uso: sf-atlas normalize --char <nome>');
  const index = await readManifest(root, char);
  const path = (p: string) => join(assetsDir(root), index.dir, `${p}.skin.json`);
  const base = JSON.parse(await readFile(path(index.default), 'utf8'));
  if (!Number.isFinite(headHeight(base))) throw new Error(`${index.default}.skin.json sem measure.headTop/chin`);
  for (const { name: p } of index.poses) {
    if (!existsSync(path(p))) {
      console.log(`  ${p}: sem skin.json ainda`);
      continue;
    }
    const skin = JSON.parse(await readFile(path(p), 'utf8'));
    const h = headHeight(skin);
    if (!Number.isFinite(h)) {
      console.log(`  ${p}: sem measure (pulando)`);
      continue;
    }
    skin.scale = normalizedScale(base, skin);
    await writeFile(path(p), formatSkin(skin));
    console.log(`  ${p}: cabeça ${h.toFixed(1)} px → scale ${skin.scale} (cabeça no mundo ${(h * skin.scale).toFixed(1)} px)`);
  }
}

/**
 * Esqueleto inicial de uma pose nova (só se ainda não houver <pose>.skin.json): o da pose base,
 * redimensionado da imagem base para a nova (ossos e medida da cabeça), com a escala normalizada
 * por essa medida. É só o ponto de partida: o ajuste fino é no Pose Lab.
 */
async function initialSkeleton(
  root: string,
  char: string,
  source: { dir: string; pose: string },
  dir: string,
  pose: string,
  w: number,
  h: number,
  has2x: boolean,
): Promise<void> {
  const file = join(assetsDir(root), dir, `${pose}.skin.json`);
  if (existsSync(file)) return;
  if (source.dir === dir && pose === source.pose)
    return console.log(`  sem esqueleto: na primeira pose de um personagem, copie o da pose base de outro com --skeleton <id> (rode de novo com --replace)`);
  const baseFile = join(assetsDir(root), source.dir, `${source.pose}.skin.json`);
  if (!existsSync(baseFile))
    return console.log(
      source.dir === dir
        ? `  sem esqueleto para copiar (${source.pose}.skin.json). Na primeira pose de um personagem, copie o de outro: --skeleton <id>`
        : `  ${source.dir}/${source.pose}.skin.json não existe: escolha outro personagem em --skeleton`,
    );
  const base = JSON.parse(await readFile(baseFile, 'utf8'));
  const meta = await sharp(join(assetsDir(root), source.dir, base.image ?? `${source.pose}.webp`)).metadata();
  const kx = w / meta.width!, ky = h / meta.height!;
  const pt = (p: number[]) => [Math.round(p[0]! * kx * 10) / 10, Math.round(p[1]! * ky * 10) / 10];
  const skin = {
    version: 1,
    char,
    pose,
    image: `${pose}.webp`,
    ...(has2x ? { image2x: `${pose}@2x.webp` } : {}),
    scale: 1,
    ...(base.measure ? { measure: { headTop: pt(base.measure.headTop), chin: pt(base.measure.chin) } } : {}),
    mesh: base.mesh,
    bones: (base.bones as { head: number[]; tail: number[] }[]).map((b) => ({ ...b, head: pt(b.head), tail: pt(b.tail) })),
    chains: base.chains ?? [],
  };
  if (skin.measure) skin.scale = normalizedScale(base, skin);
  await writeFile(file, formatSkin(skin));
  console.log(`  esqueleto inicial copiado de ${source.dir === dir ? `"${source.pose}"` : `${source.dir}/${source.pose}`} → ${pose}.skin.json (ajuste no Pose Lab)`);
}

/** Manifesto legível: `character` aberto, uma pose (e uma provisória) por linha. */
export function formatManifest(m: Record<string, unknown>): string {
  const line = (v: unknown) => JSON.stringify(v).replace(/","/g, '", "').replace(/":/g, '": ').replace(/,"/g, ', "').replace(/\{"/g, '{ "').replace(/\}/g, ' }').replace(/\{ +\}/g, '{}');
  const out = Object.entries(m).map(([k, v]) => {
    if (k === 'character' && v && typeof v === 'object')
      return `  "character": {\n${Object.entries(v).map(([ck, cv]) => `    ${JSON.stringify(ck)}: ${line(cv)}`).join(',\n')}\n  }`;
    if (k === 'poses' && Array.isArray(v)) return `  "poses": [\n${v.map((p) => '    ' + line(p)).join(',\n')}\n  ]`;
    if (k === 'provisional' && v && typeof v === 'object')
      return `  "provisional": {\n${Object.entries(v).map(([pk, pv]) => `    ${JSON.stringify(pk)}: ${line(pv)}`).join(',\n')}\n  }`;
    return `  ${JSON.stringify(k)}: ${line(v)}`;
  });
  return `{\n${out.join(',\n')}\n}\n`;
}

/** skin.json legível: um osso por linha. */
export function formatSkin(skin: Record<string, unknown> & { bones: unknown[]; chains?: unknown[] }): string {
  const { bones, chains = [], ...rest } = skin;
  const head = Object.entries(rest)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(',\n');
  return `{\n${head},\n  "bones": [\n${bones.map((b) => '    ' + JSON.stringify(b)).join(',\n')}\n  ],\n  "chains": [\n${chains.map((c) => '    ' + JSON.stringify(c)).join(',\n')}\n  ]\n}\n`;
}

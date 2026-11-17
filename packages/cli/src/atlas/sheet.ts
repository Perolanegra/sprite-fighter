/**
 * sf sheet: recorta uma folha de peças (PNG, fundo branco) em um atlas.
 *
 *   sf sheet assets/sheets/<id>-sheet-parts.png --char <id>
 *   sf sheet <folha.png> --char <nome> [--out <assets>/atlas] [--min-area 400] [--upscale 2]
 *
 * Saída em <out>/: <char>.atlas.png, <char>.atlas.json, preview-<char>.png (peças numeradas) e
 * names/<char>.json ({ "12": "thigh_1", ... }). Na primeira vez os nomes são "part_<n>": edite o
 * arquivo olhando a prévia e rode de novo.
 *
 * Poses-chave (Fase 3.5): `sf pose <folha> --char <c> --pose <p> --rect x,y,w,h` (ver pose.ts).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { assetsDir, projectRoot } from '../paths.js';
import { applyMask, foregroundMask } from './background.js';
import { connectedComponents, sortReadingOrder } from './components.js';
import { createImage, type Rect, type RgbaImage } from './image.js';
import { isOverlayName, isValidPartName, validateNames } from './names.js';
import { packShelves } from './pack.js';
import { splitTiles } from './split.js';

const MARGIN = 2;

interface Args {
  sheet: string;
  char: string;
  out: string;
  minArea: number;
  upscale: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const sheet = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  const char = get('--char');
  if (!sheet || !char) {
    console.error('uso: sf sheet <folha.png> --char <nome> [--out <assets>/atlas] [--min-area 400] [--upscale 2]');
    process.exit(1);
  }
  // Caminhos relativos à raiz do monorepo (npm -w roda dentro do pacote).
  const root = projectRoot();
  return {
    sheet: resolve(root, sheet),
    char,
    out: get('--out') ? resolve(root, get('--out')!) : join(assetsDir(root), 'atlas'),
    minArea: Number(get('--min-area') ?? 400),
    upscale: Number(get('--upscale') ?? 1),
  };
}

async function loadSheet(path: string, upscale: number): Promise<RgbaImage> {
  let img = sharp(path).ensureAlpha();
  if (upscale !== 1) {
    const meta = await sharp(path).metadata();
    img = img.resize(Math.round(meta.width! * upscale), Math.round(meta.height! * upscale), { kernel: 'lanczos3' });
  }
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

const toPng = (img: RgbaImage) =>
  sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 4 },
  }).png();

interface Piece {
  label: number;
  /** Onde a peça está na folha (sem margem). */
  rect: Rect;
  fill: number;
}

/** `sf sheet <folha.png> --char <id>`: recorta uma folha de peças em atlas (rig de peças, opcional). */
export async function runSheet(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const sheet = await loadSheet(args.sheet, args.upscale);
  const mask = foregroundMask(sheet);
  const cut = applyMask(sheet, mask);
  const { labels, parts } = connectedComponents(mask, sheet.width, sheet.height, args.minArea * args.upscale ** 2);

  // Azulejos encostados (quase retangulares) são divididos nas costuras.
  const pieces: Piece[] = [];
  for (const part of parts) {
    const rects = part.fill > 0.85 ? splitTiles(sheet, labels, part.id, part.bbox, { light: 225, seam: 0.8, minTile: 24 * args.upscale }) : [part.bbox];
    for (const rect of rects) pieces.push({ label: part.id, rect, fill: rects.length > 1 ? 1 : part.fill });
  }
  const ordered = sortReadingOrder(pieces.map((p) => ({ ...p, bbox: p.rect })));

  // Nomes: names/<char>.json, ou "part_<n>" enquanto não forem dados.
  const namesPath = join(args.out, 'names', `${args.char}.json`);
  const names: Record<string, string> = existsSync(namesPath) ? JSON.parse(await readFile(namesPath, 'utf8')) : {};
  const named = Object.keys(names).length > 0;
  if (named) {
    const errors = validateNames(names, ordered.length);
    if (errors.length) {
      console.error(`Nomes inválidos em ${namesPath}:\n  ${errors.join('\n  ')}`);
      process.exitCode = 1;
    }
  }

  // Recorte de cada peça (só os pixels dela, com margem transparente) e empacotamento.
  const crops = ordered.map((piece) => {
    const r = piece.rect;
    const img = createImage(r.w + MARGIN * 2, r.h + MARGIN * 2);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const p = (r.y + y) * sheet.width + r.x + x;
        if (labels[p] !== piece.label) continue;
        const si = p * 4;
        const ti = ((y + MARGIN) * img.width + x + MARGIN) * 4;
        for (let c = 0; c < 4; c++) img.data[ti + c] = cut.data[si + c]!;
      }
    }
    return img;
  });
  const packed = packShelves(crops.map((c) => ({ w: c.width, h: c.height })));
  const atlas = createImage(packed.width, packed.height);
  crops.forEach((crop, i) => {
    const at = packed.places[i]!;
    for (let y = 0; y < crop.height; y++) {
      const from = y * crop.width * 4;
      atlas.data.set(crop.data.subarray(from, from + crop.width * 4), ((at.y + y) * atlas.width + at.x) * 4);
    }
  });

  const entries = ordered.map((piece, i) => {
    const n = i + 1;
    const name = names[String(n)] ?? `part_${n}`;
    const at = packed.places[i]!;
    const crop = crops[i]!;
    const kind = isOverlayName(name) || (!named && piece.fill > 0.93) ? 'overlay' : 'part';
    return {
      name,
      n,
      kind,
      x: at.x,
      y: at.y,
      w: crop.width,
      h: crop.height,
      // Onde o recorte (com a margem) estava na folha, na escala da folha original.
      sourceRect: {
        x: (piece.rect.x - MARGIN) / args.upscale,
        y: (piece.rect.y - MARGIN) / args.upscale,
        w: crop.width / args.upscale,
        h: crop.height / args.upscale,
      },
    };
  });

  await mkdir(join(args.out, 'names'), { recursive: true });
  const base = join(args.out, args.char);
  await toPng(atlas).toFile(`${base}.atlas.png`);
  await writeFile(
    `${base}.atlas.json`,
    JSON.stringify(
      {
        version: 1,
        char: args.char,
        image: `${args.char}.atlas.png`,
        width: atlas.width,
        height: atlas.height,
        scale: args.upscale,
        sheet: { width: sheet.width / args.upscale, height: sheet.height / args.upscale },
        parts: entries,
      },
      null,
      2,
    ) + '\n',
  );
  if (!named) {
    await writeFile(namesPath, JSON.stringify(Object.fromEntries(entries.map((e) => [String(e.n), e.name])), null, 2) + '\n');
  }

  // Prévia: as peças recortadas no lugar da folha, sobre fundo escuro, com número (e nome).
  const labelsSvg = ordered
    .map((piece, i) => {
      const e = entries[i]!;
      const r = piece.rect;
      const text = named ? `${e.n} ${e.name}` : String(e.n);
      const color = e.kind === 'overlay' ? '#ffb347' : '#5ee0ff';
      const tx = r.x + 4;
      const ty = r.y + 18 * args.upscale;
      return (
        `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="${color}" stroke-width="${args.upscale}" stroke-dasharray="6 4"/>` +
        `<text x="${tx}" y="${ty}" font-family="sans-serif" font-weight="700" font-size="${16 * args.upscale}" fill="#000" stroke="#000" stroke-width="4">${text}</text>` +
        `<text x="${tx}" y="${ty}" font-family="sans-serif" font-weight="700" font-size="${16 * args.upscale}" fill="${color}">${text}</text>`
      );
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width}" height="${sheet.height}">${labelsSvg}</svg>`;
  await sharp({ create: { width: sheet.width, height: sheet.height, channels: 4, background: '#2a2c38' } })
    .composite([{ input: await toPng(cut).toBuffer() }, { input: Buffer.from(svg) }])
    .png()
    .toFile(join(args.out, `preview-${args.char}.png`));

  const overlays = entries.filter((e) => e.kind === 'overlay').length;
  console.log(
    `${args.char}: ${entries.length} peças (${overlays} overlay) → ${base}.atlas.png (${atlas.width}×${atlas.height})` +
      (named ? '' : `\n  nomes provisórios em ${namesPath}: preencha olhando ${join(args.out, `preview-${args.char}.png`)}`),
  );
  const unnamed = entries.filter((e) => !isValidPartName(e.name)).length;
  if (named && unnamed) console.log(`  ${unnamed} nome(s) fora da convenção`);
}

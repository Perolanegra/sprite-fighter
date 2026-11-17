import type { RgbaImage } from './image.js';

export interface BackgroundOptions {
  /** Canal mais escuro mínimo pra contar como "quase branco". */
  minChannel: number;
  /** Diferença máxima entre canais (saturação baixa), pra não apagar o creme do sobretudo. */
  maxSaturation: number;
  /** Abaixo deste valor do canal mais escuro, o pixel da borda é totalmente opaco. */
  edgeOpaqueBelow: number;
}

export const DEFAULT_BACKGROUND: BackgroundOptions = { minChannel: 240, maxSaturation: 14, edgeOpaqueBelow: 100 };

function isNearWhite(d: Uint8ClampedArray, i: number, o: BackgroundOptions): boolean {
  const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
  const min = Math.min(r, g, b);
  return min >= o.minChannel && Math.max(r, g, b) - min <= o.maxSaturation;
}

/**
 * Máscara do fundo: pixels quase brancos ligados à borda da imagem (flood fill a partir das bordas).
 * Branco cercado por contorno (a camisa, o brilho do sapato) não é alcançado e continua peça.
 * Retorna 1 = peça, 0 = fundo.
 */
export function foregroundMask(img: RgbaImage, o: BackgroundOptions = DEFAULT_BACKGROUND): Uint8Array {
  const { width: w, height: h, data } = img;
  const mask = new Uint8Array(w * h).fill(1);
  const stack: number[] = [];
  const seed = (x: number, y: number) => {
    const p = y * w + x;
    if (mask[p] === 1 && isNearWhite(data, p * 4, o)) {
      mask[p] = 0;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }
  return mask;
}

/**
 * Aplica a máscara no alfa, suavizando ~1 px de borda: nos pixels de peça vizinhos ao fundo, o alfa
 * sai do quanto o pixel é "branco" (o antisserrilhado da folha misturou contorno e fundo) e a cor é
 * "desmisturada" do branco, pra não deixar halo claro sobre fundo escuro.
 */
export function applyMask(img: RgbaImage, mask: Uint8Array, o: BackgroundOptions = DEFAULT_BACKGROUND): RgbaImage {
  const { width: w, height: h } = img;
  const data = new Uint8ClampedArray(img.data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      if (!mask[p]) {
        data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
        continue;
      }
      const edge =
        (x > 0 && !mask[p - 1]) || (x < w - 1 && !mask[p + 1]) || (y > 0 && !mask[p - w]) || (y < h - 1 && !mask[p + w]);
      if (!edge) {
        data[i + 3] = 255;
        continue;
      }
      const min = Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
      const a = Math.min(1, Math.max(0.05, (255 - min) / (255 - o.edgeOpaqueBelow)));
      for (let c = 0; c < 3; c++) data[i + c] = 255 - (255 - data[i + c]!) / a;
      data[i + 3] = Math.round(a * 255);
    }
  }
  return { width: w, height: h, data };
}

/**
 * Buracos fechados de fundo: regiões de branco PURO (canal mínimo >= `minChannel`, quase sem
 * saturação) cercadas pela figura, como o vão entre o braço e o sobretudo. O flood fill pelas
 * bordas não chega nelas. Só regiões com área >= `minArea` saem (brilhos pequenos ficam), e o
 * limiar é mais alto que o do fundo pra não apagar camisa/luzes claras (~240–246).
 */
export function removeEnclosedHoles(img: RgbaImage, mask: Uint8Array, opts = { minChannel: 250, maxSaturation: 5, minArea: 200 }): number {
  const { width: w, height: h, data } = img;
  const white = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    const mn = Math.min(data[i]!, data[i + 1]!, data[i + 2]!), mx = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
    if (mn >= opts.minChannel && mx - mn <= opts.maxSaturation) white[p] = 1;
  }
  const seen = new Uint8Array(w * h);
  let removed = 0;
  const stack: number[] = [];
  const region: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!white[start] || seen[start]) continue;
    region.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      region.push(p);
      const x = p % w, y = (p - x) / w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
        if (q >= 0 && white[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
    }
    if (region.length >= opts.minArea) {
      for (const p of region) mask[p] = 0;
      // Mais um anel de pixels claros em volta (o antisserrilhado do vão), pra não ficar pontilhado.
      for (const p of region) {
        const x = p % w, y = (p - x) / w;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
          if (q < 0 || !mask[q]) continue;
          const i = q * 4;
          const mn = Math.min(data[i]!, data[i + 1]!, data[i + 2]!), mx = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
          if (mn >= 228 && mx - mn <= 12) mask[q] = 0;
        }
      }
      removed++;
    }
  }
  return removed;
}

import type { Rect, RgbaImage } from './image.js';

/**
 * Peças "azulejo" encostadas (olhos/bocas em quadrados de pele, lado a lado) viram um componente só.
 * Aqui elas são separadas pelas costuras: colunas/linhas da caixa em que quase todo pixel é claro
 * (a linha fina entre um azulejo e outro). Sem costura, devolve a caixa inteira.
 */
export function splitTiles(img: RgbaImage, labels: Int32Array, label: number, box: Rect, opts = { light: 225, seam: 0.8, minTile: 24 }): Rect[] {
  const isSeamPixel = (x: number, y: number) => {
    const p = y * img.width + x;
    if (labels[p] !== label) return true; // buraco/fundo também separa
    const i = p * 4;
    return Math.min(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!) >= opts.light;
  };
  const cuts = (len: number, cross: number, at: (a: number, b: number) => boolean) => {
    const seams: boolean[] = [];
    for (let a = 0; a < len; a++) {
      let n = 0;
      for (let b = 0; b < cross; b++) if (at(a, b)) n++;
      seams.push(n / cross >= opts.seam);
    }
    // Intervalos sem costura com tamanho mínimo de azulejo.
    const spans: [number, number][] = [];
    let start = -1;
    for (let a = 0; a <= len; a++) {
      const solid = a < len && !seams[a];
      if (solid && start < 0) start = a;
      if (!solid && start >= 0) {
        if (a - start >= opts.minTile) spans.push([start, a]);
        start = -1;
      }
    }
    return spans.length ? spans : [[0, len] as [number, number]];
  };
  const cols = cuts(box.w, box.h, (a, b) => isSeamPixel(box.x + a, box.y + b));
  const rects: Rect[] = [];
  for (const [c0, c1] of cols) {
    const rows = cuts(box.h, c1 - c0, (a, b) => isSeamPixel(box.x + c0 + b, box.y + a));
    for (const [r0, r1] of rows) rects.push({ x: box.x + c0, y: box.y + r0, w: c1 - c0, h: r1 - r0 });
  }
  return rects;
}

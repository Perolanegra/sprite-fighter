import { createImage, type RgbaImage } from './image.js';

/** Imagem de teste a partir de linhas de caracteres: '.' branco, '#' preto, 's' pele, 'c' creme. */
export function fromAscii(rows: string[]): RgbaImage {
  const colors: Record<string, [number, number, number]> = {
    '.': [255, 255, 255],
    '#': [20, 20, 20],
    s: [235, 170, 120],
    c: [242, 236, 224],
    w: [250, 250, 250],
  };
  const img = createImage(rows[0]!.length, rows.length);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const [r, g, b] = colors[ch]!;
      img.data.set([r, g, b, 255], (y * img.width + x) * 4);
    }),
  );
  return img;
}

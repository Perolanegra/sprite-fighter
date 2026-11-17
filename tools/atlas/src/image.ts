/** Imagem RGBA crua (8 bits por canal), independente do sharp, para a lógica pura ser testável. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function createImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Copia `rect` de `src` para `dst` em (dx, dy). */
export function blit(src: RgbaImage, rect: Rect, dst: RgbaImage, dx: number, dy: number): void {
  for (let y = 0; y < rect.h; y++) {
    const sy = rect.y + y;
    const ty = dy + y;
    if (sy < 0 || sy >= src.height || ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < rect.w; x++) {
      const sx = rect.x + x;
      const tx = dx + x;
      if (sx < 0 || sx >= src.width || tx < 0 || tx >= dst.width) continue;
      const si = (sy * src.width + sx) * 4;
      const ti = (ty * dst.width + tx) * 4;
      dst.data[ti] = src.data[si]!;
      dst.data[ti + 1] = src.data[si + 1]!;
      dst.data[ti + 2] = src.data[si + 2]!;
      dst.data[ti + 3] = src.data[si + 3]!;
    }
  }
}

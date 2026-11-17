export interface PackItem {
  w: number;
  h: number;
}

export interface Placement {
  x: number;
  y: number;
}

/**
 * Empacotamento em prateleiras: mais altas primeiro, linha a linha, com `gap` px entre as peças
 * (evita vazar cor de uma peça na vizinha com filtragem bilinear). Largura em potência de 2.
 */
export function packShelves(items: PackItem[], gap = 2, maxWidth = 2048): { width: number; height: number; places: Placement[] } {
  const order = items.map((_, i) => i).sort((a, b) => items[b]!.h - items[a]!.h || items[b]!.w - items[a]!.w);
  const totalArea = items.reduce((s, it) => s + (it.w + gap) * (it.h + gap), 0);
  const widest = Math.max(0, ...items.map((it) => it.w + gap));
  let width = 256;
  while (width < maxWidth && (width < widest || width * width < totalArea * 1.15)) width *= 2;
  const places: Placement[] = new Array(items.length);
  let x = gap, y = gap, shelf = 0;
  for (const i of order) {
    const it = items[i]!;
    if (x + it.w + gap > width) {
      x = gap;
      y += shelf + gap;
      shelf = 0;
    }
    places[i] = { x, y };
    x += it.w + gap;
    shelf = Math.max(shelf, it.h);
  }
  return { width, height: y + shelf + gap, places };
}

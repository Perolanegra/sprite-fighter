import type { Rect } from './image.js';

export interface Component {
  /** Rótulo interno (1..n na ordem de leitura, depois de `sortReadingOrder`). */
  id: number;
  bbox: Rect;
  area: number;
  /** Fração da caixa ocupada pela peça (≈1 para quadrados de olhos/boca). */
  fill: number;
}

/**
 * Componentes conectados (8 vizinhos) da máscara. Retorna o mapa de rótulos (0 = fundo) e os
 * componentes com área >= `minArea` (sujeira menor é descartada do mapa também).
 */
export function connectedComponents(mask: Uint8Array, w: number, h: number, minArea: number): { labels: Int32Array; parts: Component[] } {
  const labels = new Int32Array(w * h);
  const parts: Component[] = [];
  const stack: number[] = [];
  const members: number[] = [];
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = ++next;
    labels[start] = label;
    stack.push(start);
    members.length = 0;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    while (stack.length) {
      const p = stack.pop()!;
      members.push(p);
      const x = p % w;
      const y = (p - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((!dx && !dy) || nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] && !labels[q]) {
            labels[q] = label;
            stack.push(q);
          }
        }
      }
    }
    if (members.length < minArea) {
      for (const p of members) labels[p] = -1;
      continue;
    }
    const bbox = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    parts.push({ id: label, bbox, area: members.length, fill: members.length / (bbox.w * bbox.h) });
  }
  for (let p = 0; p < labels.length; p++) if (labels[p]! < 0) labels[p] = 0;
  return { labels, parts };
}

/**
 * Ordem de leitura estável (linhas de cima pra baixo, esquerda pra direita): peças cujo centro
 * vertical cai dentro da faixa da primeira peça da linha ficam na mesma linha.
 */
export function sortReadingOrder<T extends { bbox: Rect }>(parts: T[]): T[] {
  const byTop = [...parts].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const rows: T[][] = [];
  for (const part of byTop) {
    const cy = part.bbox.y + part.bbox.h / 2;
    const row = rows.find((r) => {
      const head = r[0]!.bbox;
      return cy >= head.y && cy <= head.y + head.h;
    });
    if (row) row.push(part);
    else rows.push([part]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.bbox.x - b.bbox.x));
}

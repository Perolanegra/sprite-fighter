import { describe, expect, it } from 'vitest';
import { connectedComponents } from './components.js';
import { splitTiles } from './split.js';
import { fromAscii } from './testing.js';

describe('splitTiles', () => {
  it('separa azulejos encostados pela costura clara entre eles', () => {
    const tile = 'ssss';
    const rows = Array.from({ length: 5 }, () => `${tile}w${tile}`);
    const img = fromAscii(rows);
    const mask = new Uint8Array(img.width * img.height).fill(1);
    const { labels, parts } = connectedComponents(mask, img.width, img.height, 1);
    const rects = splitTiles(img, labels, parts[0]!.id, parts[0]!.bbox, { light: 225, seam: 0.8, minTile: 3 });
    expect(rects).toEqual([
      { x: 0, y: 0, w: 4, h: 5 },
      { x: 5, y: 0, w: 4, h: 5 },
    ]);
  });

  it('sem costura, devolve a caixa inteira', () => {
    const img = fromAscii(['ssssss', 'ssssss', 'ssssss']);
    const mask = new Uint8Array(18).fill(1);
    const { labels, parts } = connectedComponents(mask, 6, 3, 1);
    expect(splitTiles(img, labels, parts[0]!.id, parts[0]!.bbox, { light: 225, seam: 0.8, minTile: 2 })).toEqual([parts[0]!.bbox]);
  });
});

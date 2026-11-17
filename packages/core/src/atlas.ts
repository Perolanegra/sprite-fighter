import { Reader } from './validate.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasPart {
  name: string;
  kind: 'part' | 'overlay';
  /** Recorte na textura do atlas. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Onde o recorte estava na folha original. */
  sourceRect: Rect;
}

export interface AtlasData {
  char: string;
  image: string;
  width: number;
  height: number;
  /** Escala da textura em relação à folha (upscale do CLI). O rig trabalha na escala da folha. */
  scale: number;
  parts: AtlasPart[];
}

/** Valida o JSON gerado pelo `npm run atlas`. */
export function parseAtlas(json: unknown, source = 'atlas'): AtlasData {
  const r = new Reader(source, json);
  r.object();
  const names = new Set<string>();
  const parts = r.at('parts').array().map((p) => {
    const name = p.at('name').string();
    if (names.has(name)) p.at('name').fail(`peça "${name}" repetida`);
    names.add(name);
    const src = p.at('sourceRect');
    return {
      name,
      kind: p.at('kind').oneOf(['part', 'overlay'] as const, 'part'),
      x: p.at('x').number(),
      y: p.at('y').number(),
      w: p.at('w').number(),
      h: p.at('h').number(),
      sourceRect: { x: src.at('x').number(), y: src.at('y').number(), w: src.at('w').number(), h: src.at('h').number() },
    };
  });
  if (!parts.length) r.at('parts').fail('nenhuma peça');
  return {
    char: r.at('char').string(),
    image: r.at('image').string(),
    width: r.at('width').number(),
    height: r.at('height').number(),
    scale: r.at('scale').optNumber(1),
    parts,
  };
}

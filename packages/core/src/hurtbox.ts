import type { Capsule } from './collision.js';
import type { Vec2 } from './math.js';
import type { Skeleton } from './skeleton.js';

/**
 * Raio da hurtbox de cada osso, estimado pela largura da silhueta em volta dele: em 5 pontos ao
 * longo do osso, mede a distância até o alfa sumir dos dois lados (perpendicular) e tira a mediana
 * da meia-largura. 0 = osso sem hurtbox (tecido, ou fora da figura). Em px da imagem. Pura.
 */
export function estimateHurtRadii(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  bones: { head: Vec2; tail: Vec2; body: boolean }[],
): Float32Array {
  const opaque = (x: number, y: number) => {
    const xi = Math.round(x), yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < width && yi < height && alpha[yi * width + xi]! >= 128;
  };
  return Float32Array.from(
    bones.map((b) => {
      if (!b.body) return 0;
      const dx = b.tail.x - b.head.x, dy = b.tail.y - b.head.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) return 0;
      const nx = -dy / len, ny = dx / len;
      const max = Math.max(len, 40);
      const halves: number[] = [];
      for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const px = b.head.x + dx * t, py = b.head.y + dy * t;
        if (!opaque(px, py)) continue;
        const reach = (sign: number) => {
          let d = 0;
          while (d < max && opaque(px + nx * sign * (d + 1), py + ny * sign * (d + 1))) d++;
          return d;
        };
        halves.push((reach(1) + reach(-1)) / 2);
      }
      if (!halves.length) return 0;
      halves.sort((a, c) => a - c);
      return halves[halves.length >> 1]!;
    }),
  );
}

/** Hurtboxes no mundo: uma cápsula por osso com raio > 0, do pivô à outra ponta. */
export function hurtboxesOf(skeleton: Skeleton, radii: Float32Array): (Capsule & { bone: number })[] {
  const out: (Capsule & { bone: number })[] = [];
  skeleton.rig.bones.forEach((_, i) => {
    const r = radii[i] ?? 0;
    if (r <= 0) return;
    const m = skeleton.world[i]!;
    // A matriz de mundo já leva a escala da pose e do actor; o raio acompanha.
    const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    out.push({ a: skeleton.pivotWorld(i), b: skeleton.endWorld(i), r: r * k, bone: i });
  });
  return out;
}

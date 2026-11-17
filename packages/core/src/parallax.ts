import type { CanvasRenderer } from './renderer.js';

/** Camada de cenário: uma imagem repetida na horizontal, que anda `factor` × a câmera. */
export interface ParallaxLayer {
  image: CanvasImageSource & { width: number; height: number };
  /** 0 = parada no infinito, 1 = anda junto com o mundo. */
  factor: number;
  /** Altura (mundo, na camada) da base da imagem. */
  bottom: number;
  /** Escala da imagem (px da camada por px da imagem). */
  scale?: number;
  alpha?: number;
  /** Deriva própria (px da camada por segundo; nuvens). */
  drift?: number;
}

/**
 * Paralaxe: cada camada é vista por uma câmera "mais longe" (deslocamento × factor, zoom ^ factor).
 * `time` (s) move as camadas com deriva. Desenhar antes dos personagens.
 */
export function drawParallax(r: CanvasRenderer, layers: ParallaxLayer[], time = 0): void {
  const { ctx } = r;
  const cam = r.camera;
  const W = r.canvas.width, H = r.canvas.height;
  ctx.save();
  for (const l of layers) {
    const z = Math.pow(cam.zoom, l.factor) * r.dpr;
    const s = (l.scale ?? 1) * z;
    const iw = l.image.width * s, ih = l.image.height * s;
    if (iw < 1) continue;
    const ox = W / 2 - (cam.x * l.factor - (l.drift ?? 0) * time) * z;
    const by = H / 2 + (l.bottom - cam.y * l.factor) * z;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (cam.rotation) {
      ctx.translate(W / 2, H / 2);
      ctx.rotate(cam.rotation);
      ctx.translate(-W / 2, -H / 2);
    }
    ctx.globalAlpha = l.alpha ?? 1;
    const start = ((ox % iw) + iw) % iw - iw;
    for (let x = start - iw; x < W + iw; x += iw) ctx.drawImage(l.image, x, by - ih, iw + 0.5, ih);
  }
  ctx.restore();
}

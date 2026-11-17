// Cópia do cenário da demo (apps/demo/src/backdrop.ts): cidade em paralaxe e céu, sem imagens externas.
import { createRng, type CanvasRenderer, type ParallaxLayer } from 'sprite-fighter';

/**
 * Cenário da demo em camadas (paralaxe): nuvens, cidade ao longe, cidade no meio e prédios
 * perto. Gerado com RNG de semente (o mesmo sempre), sem imagens externas.
 */
export function cityLayers(centerY: number, seed = 5): ParallaxLayer[] {
  const rng = createRng(seed);
  const city = (w: number, h: number, color: string, windows: string | null, minH: number, maxH: number) => {
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d')!;
    let x = 0;
    while (x < w) {
      const bw = 50 + rng() * 120;
      const bh = minH + rng() * (maxH - minH);
      g.fillStyle = color;
      g.fillRect(x, h - bh, Math.min(bw, w - x), bh);
      if (rng() < 0.3) g.fillRect(x + bw * 0.4, h - bh - 30, 6, 30); // antena
      if (windows)
        for (let wy = h - bh + 14; wy < h - 10; wy += 22)
          for (let wx = x + 10; wx < x + bw - 14; wx += 18)
            if (rng() < 0.35) {
              g.fillStyle = windows;
              g.fillRect(wx, wy, 7, 10);
              g.fillStyle = color;
            }
      x += bw + rng() * 14;
    }
    return c;
  };
  const clouds = (() => {
    // Nuvens que emendam na repetição (desenhadas também uma volta antes/depois) e cabem na altura.
    const W = 2400, H = 560;
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d')!;
    for (let i = 0; i < 14; i++) {
      const cx = rng() * W, r = 50 + rng() * 90, cy = r + 10 + rng() * (H - 2 * r - 20);
      for (const dx of [-W, 0, W]) {
        g.save();
        g.translate(cx + dx, cy);
        g.scale(2.2, 1);
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
        grad.addColorStop(0, 'rgba(160,180,220,0.2)');
        grad.addColorStop(1, 'rgba(160,180,220,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
    return c;
  })();
  return [
    // `bottom` relativo ao centro da cena: com a câmera ali, a base fica perto do pé da tela.
    { image: clouds, factor: 0.08, bottom: centerY * 0.08 + 60, scale: 1, drift: 30 },
    { image: city(2600, 520, '#202a45', 'rgba(255,220,150,0.25)', 140, 420), factor: 0.2, bottom: centerY * 0.2 + 340, scale: 0.9 },
    { image: city(2400, 600, '#171e34', 'rgba(255,230,170,0.45)', 200, 560), factor: 0.45, bottom: centerY * 0.45 + 520, scale: 0.9 },
    { image: city(2200, 500, '#0d1222', 'rgba(255,240,190,0.6)', 120, 460), factor: 0.8, bottom: centerY * 0.8 + 900, scale: 1 },
  ];
}

/** Céu em gradiente (fundo, antes da paralaxe). */
export function drawSky(r: CanvasRenderer): void {
  const { ctx } = r;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, r.canvas.height);
  g.addColorStop(0, '#0f1730');
  g.addColorStop(0.65, '#2b3a62');
  g.addColorStop(1, '#4a4f72');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, r.canvas.width, r.canvas.height);
}

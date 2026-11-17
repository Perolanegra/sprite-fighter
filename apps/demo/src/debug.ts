import type { CanvasRenderer, Skeleton } from '@perolanegra/sprite-fighter';

/** Desenha os ossos: pivô (ponto), eixo até a outra ponta (linha) e, se pedido, o nome. */
export function drawBones(r: CanvasRenderer, s: Skeleton, opts: { selected?: number; names?: boolean } = {}): void {
  const { ctx } = r;
  const [a, , , d, e, f] = r.viewMatrix();
  const toScreen = (p: { x: number; y: number }) => ({ x: p.x * a + e, y: p.y * d + f });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineWidth = 2 * r.dpr;
  ctx.font = `${11 * r.dpr}px system-ui, sans-serif`;
  s.rig.bones.forEach((b, i) => {
    const p = toScreen(s.pivotWorld(i));
    const q = toScreen(s.endWorld(i));
    const sel = i === opts.selected;
    ctx.strokeStyle = sel ? '#ffd23f' : 'rgba(94, 224, 255, 0.8)';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, (sel ? 6 : 4) * r.dpr, 0, Math.PI * 2);
    ctx.fill();
    if (opts.names || sel) ctx.fillText(b.name, p.x + 6 * r.dpr, p.y - 6 * r.dpr);
  });
}

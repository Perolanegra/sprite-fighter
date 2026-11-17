import type { CanvasRenderer } from './renderer.js';
import type { World } from './world.js';

/** Projéteis: bala (risco claro no sentido do voo) e rajada (bola de energia). */
export function drawProjectiles(r: CanvasRenderer, world: World): void {
  const { ctx } = r;
  const v = r.viewMatrix();
  const k = v[0];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const p of world.projectiles) {
    const x = p.position.x * v[0] + v[4], y = p.position.y * v[3] + v[5];
    const speed = Math.hypot(p.velocity.x, p.velocity.y) || 1;
    const dx = p.velocity.x / speed, dy = p.velocity.y / speed;
    if (p.kind === 'bullet') {
      const len = 70 * k;
      const g = ctx.createLinearGradient(x - dx * len, y - dy * len, x, y);
      g.addColorStop(0, 'rgba(255,230,150,0)');
      g.addColorStop(1, 'rgba(255,250,220,1)');
      ctx.strokeStyle = g;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, p.radius * 0.8 * k);
      ctx.beginPath();
      ctx.moveTo(x - dx * len, y - dy * len);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      const rad = p.radius * k * 1.6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(140,220,255,0.95)');
      g.addColorStop(1, 'rgba(60,140,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

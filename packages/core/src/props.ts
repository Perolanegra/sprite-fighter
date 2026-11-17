import type { CanvasRenderer } from './renderer.js';
import type { Box } from './collision.js';
import type { Prop } from './world.js';

/**
 * Tipos de prop (objetos de cena com colisor de caixa): como desenhar e quais estados existem.
 * O roteiro cria com `spawnProp { type, at, size }` e muda o estado com `prop { id, action }`.
 */
export interface PropType {
  /** Estados aceitos (o primeiro é o padrão ao surgir). */
  states: string[];
  /** Estados sólidos (personagens e projéteis batem). */
  solid: string[];
  /** Ações de `prop { action }` → estado de destino. */
  actions: Record<string, string>;
  /** Desenha no mundo (antes dos personagens). `k` = progresso da última troca de estado (0..1). */
  draw(r: CanvasRenderer, prop: Prop, view: { appear: number; k: number; from: string | null }): void;
}

const types = new Map<string, PropType>();

/** Registra (ou troca) um tipo de prop. */
export function registerProp(type: string, def: PropType): void {
  types.set(type, def);
}
export function getPropType(type: string): PropType | undefined {
  return types.get(type);
}
export function propTypes(): string[] {
  return [...types.keys()];
}

/** Caixa do prop em px do buffer (sem giro da câmera: o giro da tremida é pequeno). */
function screenBox(r: CanvasRenderer, b: Box): { x: number; y: number; w: number; h: number; s: number } {
  const v = r.viewMatrix();
  return { x: b.x * v[0] + b.y * v[2] + v[4], y: b.x * v[1] + b.y * v[3] + v[5], w: b.w * v[0], h: b.h * v[3], s: v[0] };
}

/**
 * Porta: surge (cresce do centro e acende), fica aberta com luz dentro; ao fechar, a folha gira na
 * dobradiça (lado de trás) até cobrir a passagem.
 */
registerProp('door', {
  states: ['open', 'closed'],
  solid: ['closed'],
  actions: { open: 'open', close: 'closed' },
  draw(r, prop, { appear, k, from }) {
    const { ctx } = r;
    const g = screenBox(r, prop.box);
    const grow = 0.15 + 0.85 * appear;
    const h = g.h * grow, y = g.y + (g.h - h) / 2;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = Math.min(1, appear * 1.4);
    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(g.x - 10 * g.s, y - 12 * g.s, g.w + 20 * g.s, h + 12 * g.s);
    const light = ctx.createLinearGradient(g.x, 0, g.x + g.w, 0);
    light.addColorStop(0, '#fff6d8');
    light.addColorStop(1, '#f2c66a');
    ctx.fillStyle = light;
    ctx.fillRect(g.x, y, g.w, h);
    // Folha: fração da passagem coberta (fechando: 0 → 1; abrindo: 1 → 0).
    const closed = prop.state === 'closed' ? (from === 'open' ? k : 1) : from === 'closed' ? 1 - k : 0;
    if (closed > 0) {
      const w = g.w * closed;
      ctx.fillStyle = '#8a5a32';
      ctx.fillRect(g.x + g.w - w, y, w, h);
      if (closed > 0.6) {
        ctx.fillStyle = '#e0b040';
        ctx.beginPath();
        ctx.arc(g.x + g.w - w + w * 0.25, y + h * 0.52, 5 * g.s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  },
});

/** Parede: bloco de tijolos (sempre sólido). */
registerProp('wall', {
  states: ['up'],
  solid: ['up'],
  actions: {},
  draw(r, prop, { appear }) {
    const { ctx } = r;
    const g = screenBox(r, prop.box);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = appear;
    ctx.fillStyle = '#6b4a3a';
    ctx.fillRect(g.x, g.y, g.w, g.h);
    ctx.strokeStyle = 'rgba(30,18,12,0.6)';
    ctx.lineWidth = 2 * g.s;
    const bh = 26 * g.s, bw = 60 * g.s;
    ctx.beginPath();
    for (let row = 0, yy = g.y; yy < g.y + g.h; row++, yy += bh) {
      ctx.moveTo(g.x, yy);
      ctx.lineTo(g.x + g.w, yy);
      for (let xx = g.x + (row % 2 ? bw / 2 : 0); xx < g.x + g.w; xx += bw) {
        ctx.moveTo(xx, yy);
        ctx.lineTo(xx, Math.min(g.y + g.h, yy + bh));
      }
    }
    ctx.stroke();
    ctx.restore();
  },
});

/** Desenha os props do mundo (`time` = tempo da cena, s). Tipo sem registro não aparece. */
export function drawProps(r: CanvasRenderer, props: Iterable<Prop>, time: number): void {
  for (const p of props) {
    const def = types.get(p.type);
    if (!def) continue;
    const appear = p.appear && p.bornAt !== undefined ? Math.min(1, Math.max(0, (time - p.bornAt) / p.appear)) : 1;
    const dur = p.changeTime ?? 0;
    const k = p.changedAt === undefined ? 1 : dur > 0 ? Math.min(1, Math.max(0, (time - p.changedAt) / dur)) : 1;
    def.draw(r, p, { appear, k, from: p.changedAt === undefined ? null : (p.previous ?? null) });
  }
}

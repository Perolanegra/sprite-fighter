import type { CanvasRenderer } from './renderer.js';
import type { Box } from './collision.js';
import type { Vec2 } from './math.js';
import type { Prop } from './world.js';

/**
 * Abertura de um prop (passagem): a caixa por onde o corpo passa e o eixo da passagem
 * (`x` = atravessa na horizontal, como uma porta vista de lado; `y` = na vertical, como um alçapão).
 * O plano da passagem fica no meio da caixa, ao longo do eixo.
 */
export interface PropOpening {
  box: Box;
  axis: 'x' | 'y';
}

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
  /**
   * Pontos nomeados (mundo), calculados a cada chamada da caixa atual do prop: acompanham a
   * posição e o tamanho dele. Somam-se (e podem trocar) às âncoras de todo prop: `center`, `top`,
   * `bottom`, `left` e `right` (meio de cada lado da caixa).
   */
  anchors?: Record<string, (prop: Prop) => Vec2>;
  /** Passagem do prop (`enter`/`exit` e a conferência do `validate`). Sem ela, o prop não se atravessa. */
  opening?: (prop: Prop) => PropOpening;
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

/** Âncoras de todo prop (meio da caixa e de cada lado). */
export const BOX_ANCHORS: Record<string, (prop: Prop) => Vec2> = {
  center: ({ box: b }) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 }),
  top: ({ box: b }) => ({ x: b.x + b.w / 2, y: b.y }),
  bottom: ({ box: b }) => ({ x: b.x + b.w / 2, y: b.y + b.h }),
  left: ({ box: b }) => ({ x: b.x, y: b.y + b.h / 2 }),
  right: ({ box: b }) => ({ x: b.x + b.w, y: b.y + b.h / 2 }),
};

/** Nomes das âncoras de um tipo de prop (as de caixa mais as do tipo). */
export function anchorNames(type: string): string[] {
  return [...new Set([...Object.keys(BOX_ANCHORS), ...Object.keys(types.get(type)?.anchors ?? {})])];
}

/** Ponto nomeado do prop, na posição e no tamanho atuais. Nome desconhecido: erro com a lista. */
export function propAnchor(prop: Prop, name: string): Vec2 {
  const fn = types.get(prop.type)?.anchors?.[name] ?? BOX_ANCHORS[name];
  if (!fn) throw new Error(`o prop "${prop.id}" (${prop.type}) não tem a âncora "${name}" (âncoras: ${anchorNames(prop.type).join(', ')})`);
  return fn(prop);
}

/** Passagem do prop, ou null se o tipo não tem abertura. */
export function propOpening(prop: Prop): PropOpening | null {
  return types.get(prop.type)?.opening?.(prop) ?? null;
}

/** Distância (px do mundo) da frente da porta (`front`) ao plano da passagem, em alturas da porta. */
const DOOR_FRONT = 0.9;

/** Caixa do prop em px do buffer (sem giro da câmera: o giro da tremida é pequeno). */
function screenBox(r: CanvasRenderer, b: Box): { x: number; y: number; w: number; h: number; s: number } {
  const v = r.viewMatrix();
  return { x: b.x * v[0] + b.y * v[2] + v[4], y: b.x * v[1] + b.y * v[3] + v[5], w: b.w * v[0], h: b.h * v[3], s: v[0] };
}

/**
 * Porta (vista de lado, atravessada na horizontal): surge (cresce do centro e acende), fica aberta
 * com luz dentro; ao fechar, a folha gira na dobradiça (lado de trás) até cobrir a passagem.
 * Âncoras: `opening` (meio da passagem), `front` (onde se chega antes de entrar, do lado do
 * `facing` do prop, padrão -1 = esquerda), `top` e `bottom` (pontas da passagem).
 */
registerProp('door', {
  states: ['open', 'closed'],
  solid: ['closed'],
  actions: { open: 'open', close: 'closed' },
  anchors: {
    opening: ({ box: b }) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 }),
    front: ({ box: b, facing }) => ({ x: b.x + b.w / 2 + (facing ?? -1) * (b.w / 2 + b.h * DOOR_FRONT), y: b.y + b.h / 2 }),
  },
  opening: ({ box }) => ({ box, axis: 'x' }),
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

import type { Vec2 } from './math.js';
import { DataError } from './validate.js';

/**
 * Rota em subconjunto de SVG path (comandos absolutos M, L, Q, C), amostrada por comprimento de
 * arco: `point(u)` com u ∈ [0, 1] anda com velocidade constante ao longo da curva (o easing fica
 * por conta de quem chama).
 *   "M-160 560 C 500 420 1100 560 1500 520"
 */
export class Route {
  private readonly pts: Vec2[];
  private readonly acc: number[];
  readonly length: number;

  constructor(path: string, source = 'rota') {
    this.pts = flatten(path, source);
    this.acc = [0];
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1]!, b = this.pts[i]!;
      this.acc.push(this.acc[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
    }
    this.length = this.acc[this.acc.length - 1]!;
  }

  get start(): Vec2 {
    return { ...this.pts[0]! };
  }
  get end(): Vec2 {
    return { ...this.pts[this.pts.length - 1]! };
  }

  point(u: number): Vec2 {
    if (this.pts.length === 1 || this.length === 0) return this.start;
    const target = Math.max(0, Math.min(1, u)) * this.length;
    let lo = 0, hi = this.acc.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.acc[mid]! <= target) lo = mid;
      else hi = mid;
    }
    const seg = this.acc[hi]! - this.acc[lo]!;
    const t = seg > 0 ? (target - this.acc[lo]!) / seg : 0;
    const a = this.pts[lo]!, b = this.pts[hi]!;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
}

const SUBDIV = 32;

function flatten(path: string, source: string): Vec2[] {
  const tokens = path.match(/[MLQCmlqc]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const pts: Vec2[] = [];
  let i = 0;
  let cmd = '';
  const num = () => {
    const t = tokens[i++];
    const v = Number(t);
    if (t === undefined || !Number.isFinite(v)) throw new DataError(source, 'route', `número esperado no caminho "${path}"`);
    return v;
  };
  const pt = (): Vec2 => ({ x: num(), y: num() });
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i]!)) cmd = tokens[i++]!;
    if (cmd !== cmd.toUpperCase()) throw new DataError(source, 'route', `só comandos absolutos (M, L, Q, C): "${cmd}"`);
    const last = pts[pts.length - 1];
    if (cmd !== 'M' && !last) throw new DataError(source, 'route', 'o caminho precisa começar com M');
    if (cmd === 'M' || cmd === 'L') pts.push(pt());
    else if (cmd === 'Q') {
      const c = pt(), e = pt();
      for (let k = 1; k <= SUBDIV; k++) {
        const t = k / SUBDIV, u = 1 - t;
        pts.push({ x: u * u * last!.x + 2 * u * t * c.x + t * t * e.x, y: u * u * last!.y + 2 * u * t * c.y + t * t * e.y });
      }
    } else if (cmd === 'C') {
      const c1 = pt(), c2 = pt(), e = pt();
      for (let k = 1; k <= SUBDIV; k++) {
        const t = k / SUBDIV, u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        pts.push({ x: a * last!.x + b * c1.x + c * c2.x + d * e.x, y: a * last!.y + b * c1.y + c * c2.y + d * e.y });
      }
    } else throw new DataError(source, 'route', `comando desconhecido "${cmd}"`);
  }
  if (!pts.length) throw new DataError(source, 'route', 'caminho vazio');
  return pts;
}

import type { Vec2 } from './math.js';
import type { CanvasRenderer } from './renderer.js';
import { createRng } from './rng.js';

interface Spark {
  p: Vec2;
  v: Vec2;
  life: number;
  age: number;
  /** Comprimento do risco (s de rastro: o risco = velocidade × len). */
  len: number;
  width: number;
  color: string;
}

interface Burst {
  at: Vec2;
  size: number;
  age: number;
  life: number;
  /** Ângulo de cada ponta e o comprimento relativo (estrela irregular, mas fixa). */
  spikes: { a: number; r: number }[];
  rotation: number;
  color: string;
  ring: boolean;
}

interface Lines {
  frames: number;
  age: number;
  intensity: number;
  /** Linear: ângulo do movimento (rad). Radial: foco no mundo. */
  angle: number;
  focus: Vec2 | null;
  seed: number;
}

export interface SparkOptions {
  count?: number;
  /** Direção principal (normalizada); sem ela, em todas as direções. */
  dir?: Vec2 | null;
  /** Abertura em volta da direção (rad). */
  spread?: number;
  speed?: number;
  life?: number;
  color?: string;
  size?: number;
}

export interface ImpactOptions {
  /** 1 = soco médio. */
  size?: number;
  dir?: Vec2 | null;
  color?: string;
  sparks?: number;
}

export interface SpeedLineOptions {
  frames?: number;
  /** 0..1 (quantidade e opacidade). */
  intensity?: number;
  /** Ângulo do movimento (rad); as linhas correm ao contrário. */
  angle?: number;
  /** Ponto do mundo: linhas radiais convergindo nele (concentração de impacto). */
  focus?: Vec2 | null;
}

/**
 * Efeitos de mundo, em passo fixo e com RNG próprio (não mexem no RNG da simulação):
 * faíscas (riscos que voam e perdem força), estrela de impacto (pontas + anel), clarão de cano e
 * linhas de velocidade (lineares, no sentido do movimento, ou radiais num foco). Tempo em frames
 * de 60 fps; no hitstop continuam (o mundo não congela, só os personagens).
 */
export class Effects {
  readonly sparks: Spark[] = [];
  readonly bursts: Burst[] = [];
  lines: Lines | null = null;
  private readonly rng: () => number;

  constructor(seed = 1) {
    this.rng = createRng(seed * 7919 + 13);
  }

  spark(at: Vec2, o: SparkOptions = {}): void {
    const n = o.count ?? 10;
    const base = o.dir ? Math.atan2(o.dir.y, o.dir.x) : 0;
    const spread = o.dir ? (o.spread ?? 1.1) : Math.PI;
    const size = o.size ?? 1;
    for (let i = 0; i < n; i++) {
      const a = base + (this.rng() * 2 - 1) * spread;
      const sp = (o.speed ?? 900) * (0.45 + this.rng() * 0.8) * size;
      this.sparks.push({
        p: { ...at },
        v: { x: Math.cos(a) * sp, y: Math.sin(a) * sp },
        life: (o.life ?? 14) * (0.6 + this.rng() * 0.6),
        age: 0,
        len: 0.035 + this.rng() * 0.03,
        width: (2 + this.rng() * 3) * size,
        color: o.color ?? (this.rng() < 0.5 ? '#fff6c8' : '#ffd25a'),
      });
    }
  }

  impact(at: Vec2, o: ImpactOptions = {}): void {
    const size = o.size ?? 1;
    const n = 9 + Math.round(this.rng() * 4);
    const spikes = Array.from({ length: n }, (_, i) => ({ a: (i / n) * Math.PI * 2 + (this.rng() - 0.5) * 0.35, r: 0.55 + this.rng() * 0.45 }));
    this.bursts.push({ at: { ...at }, size: 110 * size, age: 0, life: 9 + 4 * size, spikes, rotation: this.rng() * Math.PI, color: o.color ?? '#fff8d0', ring: size >= 0.9 });
    this.spark(at, { count: o.sparks ?? Math.round(8 + 10 * size), dir: o.dir ?? null, spread: 1.2, speed: 1000, size: Math.max(0.7, size) });
  }

  /** Clarão curto (cano da arma, aparição). */
  muzzle(at: Vec2, dir: Vec2 | null = null, size = 0.45): void {
    const spikes = Array.from({ length: 6 }, (_, i) => ({ a: (i / 6) * Math.PI * 2, r: i % 2 ? 0.5 : 1 }));
    this.bursts.push({ at: { ...at }, size: 110 * size, age: 0, life: 5, spikes, rotation: dir ? Math.atan2(dir.y, dir.x) : 0, color: '#ffe9a0', ring: false });
    this.spark(at, { count: 4, dir, spread: 0.4, speed: 700, life: 6, size: 0.6 });
  }

  speedLines(o: SpeedLineOptions = {}): void {
    this.lines = { frames: o.frames ?? 20, age: 0, intensity: o.intensity ?? 0.7, angle: o.angle ?? 0, focus: o.focus ?? null, seed: Math.floor(this.rng() * 1e9) };
  }

  get active(): boolean {
    return this.sparks.length + this.bursts.length > 0 || !!this.lines;
  }

  /** Um passo (dt em s). */
  step(dt: number): void {
    const df = dt * 60;
    for (const s of this.sparks) {
      s.age += df;
      s.p.x += s.v.x * dt;
      s.p.y += s.v.y * dt;
      const drag = Math.exp(-7 * dt);
      s.v.x *= drag;
      s.v.y = s.v.y * drag + 900 * dt;
    }
    for (const b of this.bursts) b.age += df;
    removeDead(this.sparks);
    removeDead(this.bursts);
    if (this.lines && (this.lines.age += df) >= this.lines.frames) this.lines = null;
  }

  /** Linhas de velocidade lineares (atrás dos personagens). */
  drawBack(r: CanvasRenderer): void {
    if (this.lines && !this.lines.focus) this.drawLines(r, this.lines);
  }

  /** Estrelas, faíscas e linhas radiais (na frente). */
  drawFront(r: CanvasRenderer): void {
    const { ctx } = r;
    const v = r.viewMatrix();
    const k = Math.hypot(v[0], v[1]);
    const S = (p: Vec2) => ({ x: v[0] * p.x + v[2] * p.y + v[4], y: v[1] * p.x + v[3] * p.y + v[5] });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.bursts) {
      const t = b.age / b.life;
      const c = S(b.at);
      // Cresce rápido (2 frames) e some encolhendo as pontas.
      const grow = Math.min(1, b.age / 2);
      const R = b.size * k * (0.5 + 0.5 * grow) * (1 + 0.3 * t);
      const fade = 1 - t * t;
      ctx.globalAlpha = Math.max(0, fade);
      ctx.fillStyle = b.color;
      ctx.beginPath();
      b.spikes.forEach((sp, i) => {
        const a = sp.a + b.rotation;
        const outer = R * sp.r * (1 - 0.6 * t);
        const mid = a + Math.PI / b.spikes.length;
        const inner = R * 0.16;
        const ox = c.x + Math.cos(a) * outer, oy = c.y + Math.sin(a) * outer;
        if (i === 0) ctx.moveTo(ox, oy);
        else ctx.lineTo(ox, oy);
        ctx.lineTo(c.x + Math.cos(mid) * inner, c.y + Math.sin(mid) * inner);
      });
      ctx.closePath();
      ctx.fill();
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R * 0.45);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, R * 0.45, 0, Math.PI * 2);
      ctx.fill();
      if (b.ring) {
        ctx.strokeStyle = 'rgba(255,240,200,1)';
        ctx.globalAlpha = Math.max(0, 1 - t) * 0.8;
        ctx.lineWidth = Math.max(1, 6 * k * (1 - t));
        ctx.beginPath();
        ctx.arc(c.x, c.y, b.size * k * (0.4 + 1.3 * t), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.lineCap = 'round';
    for (const s of this.sparks) {
      const t = s.age / s.life;
      const a = S(s.p), b = S({ x: s.p.x - s.v.x * s.len, y: s.p.y - s.v.y * s.len });
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(1, s.width * k * (1 - 0.5 * t) * 2);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
    if (this.lines?.focus) this.drawLines(r, this.lines);
  }

  private drawLines(r: CanvasRenderer, l: Lines): void {
    const { ctx } = r;
    const W = r.canvas.width, H = r.canvas.height;
    // Sorteio novo a cada 2 frames (o tremido do anime), determinístico pela semente.
    const rng = createRng(l.seed + Math.floor(l.age / 2) * 977);
    const fadeIn = Math.min(1, l.age / 3), fadeOut = Math.min(1, (l.frames - l.age) / 6);
    const k = l.intensity * fadeIn * fadeOut;
    if (k <= 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineCap = 'round';
    if (!l.focus) {
      // Lineares: riscos brancos finos correndo ao contrário do movimento, por toda a tela.
      const n = Math.round(10 + 34 * l.intensity);
      const cos = Math.cos(l.angle), sin = Math.sin(l.angle);
      const diag = Math.hypot(W, H);
      for (let i = 0; i < n; i++) {
        const across = (rng() - 0.5) * diag, along = (rng() - 0.5) * diag;
        const len = (0.08 + rng() * 0.25) * W;
        const cx = W / 2 + cos * along - sin * across, cy = H / 2 + sin * along + cos * across;
        ctx.globalAlpha = k * (0.12 + rng() * 0.3);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = (1 + rng() * 2.5) * r.dpr;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - cos * len, cy - sin * len);
        ctx.stroke();
      }
    } else {
      // Radiais: cunhas da borda da tela apontando para o foco (concentração).
      const v = r.viewMatrix();
      const f = { x: v[0] * l.focus.x + v[2] * l.focus.y + v[4], y: v[1] * l.focus.x + v[3] * l.focus.y + v[5] };
      const R = Math.hypot(W, H);
      const n = Math.round(24 + 36 * l.intensity);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, w = (0.002 + rng() * 0.006) * Math.PI;
        const inner = R * (0.26 + rng() * 0.2);
        ctx.globalAlpha = k * (0.18 + rng() * 0.32);
        ctx.beginPath();
        ctx.moveTo(f.x + Math.cos(a) * inner, f.y + Math.sin(a) * inner);
        ctx.lineTo(f.x + Math.cos(a - w) * R, f.y + Math.sin(a - w) * R);
        ctx.lineTo(f.x + Math.cos(a + w) * R, f.y + Math.sin(a + w) * R);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

function removeDead<T extends { age: number; life: number }>(list: T[]): void {
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.age >= list[i]!.life) list.splice(i, 1);
}

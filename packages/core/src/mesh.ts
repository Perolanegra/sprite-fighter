import { createRng } from './rng.js';
import type { Vec2 } from './math.js';

/*
 * Malha automática de uma pose-imagem (pura, sem DOM):
 *   1. pontos de borda sobre a silhueta dilatada (a malha cobre todo pixel opaco);
 *   2. pontos internos com espaçamento menor perto das articulações e da borda (jitter com semente);
 *   3. Delaunay (Bowyer–Watson) e só os triângulos que caem dentro da silhueta (sem pontes em vãos);
 *   4. pesos por distância geodésica (pela malha) a cada osso, suavizados, até 4 por vértice;
 *      ossos de tecido só pesam onde a cor é a do tecido.
 */

export interface MeshInput {
  width: number;
  height: number;
  /** Alfa por pixel (0..255). */
  alpha: ArrayLike<number>;
  /** RGBA por pixel (para a cor do tecido). Opcional se não houver correntes. */
  rgba?: ArrayLike<number>;
  /** Segmentos dos ossos em px da imagem. `cloth` = osso de corrente de tecido. */
  bones: { head: Vec2; tail: Vec2; cloth?: boolean }[];
  target?: number;
  boundaryStep?: number;
  seed?: number;
  clothTolerance?: number;
}

export interface SkinMesh {
  /** Posições (px da imagem), 2 por vértice. */
  positions: Float32Array;
  /** Triângulos (índices de vértice), 3 por triângulo. */
  triangles: Uint16Array;
  /** Até 4 ossos por vértice e os pesos (soma 1). */
  boneIndices: Uint8Array;
  weights: Float32Array;
  vertexCount: number;
}

const ALPHA_THRESHOLD = 64;

/** Máscara binária dilatada em `r` px (quadrado). */
function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r && !v; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w && mask[y * w + xx]) v = 1;
      }
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r && !v; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1;
      }
      out[y * w + x] = v;
    }
  return out;
}

/** Distância (aprox. chamfer 3-4) de cada pixel dentro da máscara até o fundo. */
function distanceToEdge(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]!);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  for (let i = 0; i < d.length; i++) d[i] = d[i]! / 3;
  return d;
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Acumulador de pontos com vizinhança rápida (grade de células). */
class PointSet {
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  private readonly cells = new Map<number, number[]>();
  constructor(private readonly cell: number) {}
  private key(cx: number, cy: number) {
    return cy * 100003 + cx;
  }
  /** Há ponto a menos de `r` de (x, y)? */
  near(x: number, y: number, r: number): boolean {
    const c = this.cell;
    const n = Math.ceil(r / c);
    const cx = Math.floor(x / c), cy = Math.floor(y / c);
    for (let j = -n; j <= n; j++)
      for (let i = -n; i <= n; i++) {
        const list = this.cells.get(this.key(cx + i, cy + j));
        if (!list) continue;
        for (const k of list) if ((this.xs[k]! - x) ** 2 + (this.ys[k]! - y) ** 2 < r * r) return true;
      }
    return false;
  }
  add(x: number, y: number): void {
    const k = this.xs.length;
    this.xs.push(x);
    this.ys.push(y);
    const key = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    const list = this.cells.get(key);
    if (list) list.push(k);
    else this.cells.set(key, [k]);
  }
  get size() {
    return this.xs.length;
  }
}

/** Triangulação de Delaunay (Bowyer–Watson). Devolve os índices dos triângulos. */
export function delaunay(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xs[i]!);
    minY = Math.min(minY, ys[i]!);
    maxX = Math.max(maxX, xs[i]!);
    maxY = Math.max(maxY, ys[i]!);
  }
  const span = Math.max(maxX - minX, maxY - minY) * 20 + 10;
  const px = [...xs, minX - span, minX + span * 2, minX - span];
  const py = [...ys, minY - span, minY - span, minY + span * 2];
  type Tri = { a: number; b: number; c: number; cx: number; cy: number; r2: number };
  const make = (a: number, b: number, c: number): Tri => {
    const ax = px[a]!, ay = py[a]!, bx = px[b]!, by = py[b]!, cx = px[c]!, cy = py[c]!;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-12;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return { a, b, c, cx: ux, cy: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris: Tri[] = [make(n, n + 1, n + 2)];
  for (let p = 0; p < n; p++) {
    const x = px[p]!, y = py[p]!;
    const bad: Tri[] = [];
    const keep: Tri[] = [];
    for (const t of tris) ((x - t.cx) ** 2 + (y - t.cy) ** 2 < t.r2 ? bad : keep).push(t);
    // Arestas da cavidade: as que aparecem uma só vez entre os triângulos ruins.
    const edges = new Map<string, [number, number]>();
    for (const t of bad)
      for (const [u, v] of [
        [t.a, t.b],
        [t.b, t.c],
        [t.c, t.a],
      ] as [number, number][]) {
        const key = u < v ? `${u},${v}` : `${v},${u}`;
        if (edges.has(key)) edges.delete(key);
        else edges.set(key, [u, v]);
      }
    for (const [u, v] of edges.values()) keep.push(make(u, v, p));
    tris = keep;
  }
  const out: number[] = [];
  for (const t of tris) if (t.a < n && t.b < n && t.c < n) out.push(t.a, t.b, t.c);
  return out;
}

/** Pontos (borda + internos) para um espaçamento base `s`. */
function samplePoints(input: MeshInput, inside: Uint8Array, cover: Uint8Array, edgeDist: Float32Array, s: number, step: number, seed: number): PointSet {
  const { width: w, height: h, bones } = input;
  const set = new PointSet(Math.max(2, step / 2));
  // 1) Borda da silhueta dilatada.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!cover[i]) continue;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || !cover[i - 1] || !cover[i + 1] || !cover[i - w] || !cover[i + w];
      if (edge && !set.near(x + 0.5, y + 0.5, step)) set.add(x + 0.5, y + 0.5);
    }
  // 2) Internos: grade com jitter; espaçamento menor perto das articulações e da borda.
  const joints: Vec2[] = [];
  for (const b of bones) joints.push(b.head, b.tail);
  const rng = createRng(seed);
  const g = Math.max(2, s / 2);
  for (let gy = g / 2; gy < h; gy += g)
    for (let gx = g / 2; gx < w; gx += g) {
      const x = gx + (rng() - 0.5) * g * 0.8;
      const y = gy + (rng() - 0.5) * g * 0.8;
      const xi = Math.floor(x), yi = Math.floor(y);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h || !inside[yi * w + xi]) continue;
      let dj = Infinity;
      for (const j of joints) dj = Math.min(dj, Math.hypot(j.x - x, j.y - y));
      const de = edgeDist[yi * w + xi]!;
      const local = s * Math.min(1, 0.5 + 0.5 * Math.min(1, dj / (3 * s))) * Math.min(1, 0.65 + 0.35 * Math.min(1, de / (1.5 * s)));
      if (de < local * 0.45) continue; // longe o bastante da borda (que já tem pontos)
      if (!set.near(x, y, local)) set.add(x, y);
    }
  return set;
}

/** Monta a malha e os pesos de uma pose-imagem. */
export function buildSkinMesh(input: MeshInput): SkinMesh {
  const { width: w, height: h, alpha, bones } = input;
  const target = input.target ?? 600;
  const seed = input.seed ?? 1;
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < inside.length; i++) inside[i] = alpha[i]! >= ALPHA_THRESHOLD ? 1 : 0;
  // A malha cobre a silhueta dilatada: todo pixel visível (até a borda suave) fica dentro.
  const visible = new Uint8Array(w * h);
  for (let i = 0; i < visible.length; i++) visible[i] = alpha[i]! > 0 ? 1 : 0;
  const cover = dilate(visible, w, h, 1);
  const keepMask = dilate(cover, w, h, 2);
  const edgeDist = distanceToEdge(inside, w, h);
  // Passo da borda proporcional ao contorno: ~40% dos vértices na borda, o resto por dentro.
  // (Com passo fixo, um contorno longo vira só borda e os triângulos saem em leque, finos.)
  let perimeter = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (cover[i] && (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !cover[i - 1] || !cover[i + 1] || !cover[i - w] || !cover[i + w])) perimeter++;
    }
  const step = Math.max(input.boundaryStep ?? 5, (perimeter * 0.75) / (target * 0.4));

  // Espaçamento base: busca binária até o total ficar na faixa (alvo ± 30%, entre 400 e 800).
  const lo0 = Math.max(400, target * 0.85), hi0 = Math.min(800, target * 1.15);
  let lo = 4, hi = 200, points = samplePoints(input, inside, cover, edgeDist, 40, step, seed);
  for (let it = 0; it < 18; it++) {
    const s = (lo + hi) / 2;
    points = samplePoints(input, inside, cover, edgeDist, s, step, seed);
    if (points.size > hi0) lo = s;
    else if (points.size < lo0) hi = s;
    else break;
  }

  // Triângulos dentro da silhueta: centróide e amostras das arestas.
  const xs = points.xs, ys = points.ys;
  const inKeep = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    return xi >= 0 && yi >= 0 && xi < w && yi < h && keepMask[yi * w + xi] === 1;
  };
  const triangulate = (): number[] => {
    const raw = delaunay(xs, ys);
    const out: number[] = [];
    for (let t = 0; t < raw.length; t += 3) {
      const a = raw[t]!, b = raw[t + 1]!, c = raw[t + 2]!;
      const area = (xs[b]! - xs[a]!) * (ys[c]! - ys[a]!) - (xs[c]! - xs[a]!) * (ys[b]! - ys[a]!);
      if (Math.abs(area) < 0.5) continue;
      if (!inKeep((xs[a]! + xs[b]! + xs[c]!) / 3, (ys[a]! + ys[b]! + ys[c]!) / 3)) continue;
      let ok = true;
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ] as [number, number][])
        for (const k of [0.2, 0.4, 0.6, 0.8]) if (!inKeep(xs[u]! + (xs[v]! - xs[u]!) * k, ys[u]! + (ys[v]! - ys[u]!) * k)) ok = false;
      if (ok) area > 0 ? out.push(a, b, c) : out.push(a, c, b);
    }
    return out;
  };
  // Pixels visíveis que nenhum triângulo cobre (concavidades finas: dedos, pontas do cabelo).
  const uncovered = (tris: number[]): number[] => {
    const covered = new Uint8Array(w * h);
    for (let t = 0; t < tris.length; t += 3) {
      const ax = xs[tris[t]!]!, ay = ys[tris[t]!]!, bx = xs[tris[t + 1]!]!, by = ys[tris[t + 1]!]!, cx = xs[tris[t + 2]!]!, cy = ys[tris[t + 2]!]!;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
      const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (!d) continue;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const l1 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / d;
          const l2 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / d;
          if (l1 >= -0.02 && l2 >= -0.02 && 1 - l1 - l2 >= -0.02) covered[y * w + x] = 1;
        }
    }
    const miss: number[] = [];
    for (let p = 0; p < w * h; p++) if (visible[p] && alpha[p]! > 24 && !covered[p]) miss.push(p);
    return miss;
  };
  let tris = triangulate();
  for (let pass = 0; pass < 3; pass++) {
    const miss = uncovered(tris);
    if (miss.length < 4) break;
    // Um ponto novo por região descoberta (espaçados pra não explodir a contagem).
    const spacing = Math.max(3, step * 0.35);
    let added = 0;
    for (const p of miss) {
      const x = (p % w) + 0.5, y = Math.floor(p / w) + 0.5;
      if (!points.near(x, y, spacing)) {
        points.add(x, y);
        added++;
      }
    }
    if (!added) break;
    tris = triangulate();
  }
  // Só os vértices usados, reindexados.
  const used = new Int32Array(xs.length).fill(-1);
  const positions: number[] = [];
  for (const v of tris)
    if (used[v] === -1) {
      used[v] = positions.length / 2;
      positions.push(xs[v]!, ys[v]!);
    }
  const triangles = Uint16Array.from(tris.map((v) => used[v]!));
  const pos = Float32Array.from(positions);
  const { boneIndices, weights } = computeWeights(pos, triangles, input);
  return { positions: pos, triangles, boneIndices, weights, vertexCount: pos.length / 2 };
}

/** Cor média 3×3 em (x, y). */
function colorAt(rgba: ArrayLike<number>, w: number, h: number, x: number, y: number): [number, number, number, number] {
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const xx = Math.min(w - 1, Math.max(0, Math.floor(x) + i)), yy = Math.min(h - 1, Math.max(0, Math.floor(y) + j));
      const k = (yy * w + xx) * 4;
      if (rgba[k + 3]! < ALPHA_THRESHOLD) continue;
      r += rgba[k]!;
      g += rgba[k + 1]!;
      b += rgba[k + 2]!;
      a += rgba[k + 3]!;
      n++;
    }
  return n ? [r / n, g / n, b / n, a / n] : [0, 0, 0, 0];
}

/** Pesos por distância geodésica aos ossos (ver o topo do arquivo). */
export function computeWeights(positions: Float32Array, triangles: Uint16Array, input: MeshInput): { boneIndices: Uint8Array; weights: Float32Array } {
  const n = positions.length / 2;
  const bones = input.bones;
  const nb = bones.length;
  // Vizinhança da malha.
  const nbrs: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (let t = 0; t < triangles.length; t += 3)
    for (const [u, v] of [
      [triangles[t]!, triangles[t + 1]!],
      [triangles[t + 1]!, triangles[t + 2]!],
      [triangles[t + 2]!, triangles[t]!],
    ] as [number, number][]) {
      const d = Math.hypot(positions[u * 2]! - positions[v * 2]!, positions[u * 2 + 1]! - positions[v * 2 + 1]!);
      nbrs[u]!.set(v, d);
      nbrs[v]!.set(u, d);
    }
  let avgEdge = 0, edgeCount = 0;
  for (const m of nbrs) for (const d of m.values()) (avgEdge += d), edgeCount++;
  avgEdge /= edgeCount || 1;
  const pt = (v: number): Vec2 => ({ x: positions[v * 2]!, y: positions[v * 2 + 1]! });

  // Tecido: o osso de corrente só pesa onde a cor parece a do tecido sob ele. Compara com TODAS
  // as cores amostradas ao longo da corrente (luz e sombra do tecido), com um fator suave
  // (1 dentro da tolerância, 0 a partir de 1,6×) espalhado pela malha (sem corte seco entre vizinhos).
  const tol = input.clothTolerance ?? 45;
  const sampleCloth = (b: (typeof bones)[number]) => {
    const out: [number, number, number][] = [];
    for (let k = 0.05; k <= 0.96; k += 0.07) {
      const c = colorAt(input.rgba!, input.width, input.height, b.head.x + (b.tail.x - b.head.x) * k, b.head.y + (b.tail.y - b.head.y) * k);
      if (c[3] > 0) out.push([c[0], c[1], c[2]]);
    }
    return out;
  };
  const eligible: (Float32Array | null)[] = bones.map((b) => {
    if (!b.cloth || !input.rgba) return null;
    const samples = sampleCloth(b);
    if (!samples.length) return null;
    let f = new Float32Array(n);
    for (let v = 0; v < n; v++) {
      // Melhor cor numa vizinhança de ~6 px: vértices em cima do contorno herdam o tecido ao lado.
      let best = Infinity;
      for (let oy = -6; oy <= 6; oy += 3)
        for (let ox = -6; ox <= 6; ox += 3) {
          const c = colorAt(input.rgba, input.width, input.height, positions[v * 2]! + ox, positions[v * 2 + 1]! + oy);
          if (c[3] <= 0) continue;
          for (const sc of samples) best = Math.min(best, Math.hypot(c[0] - sc[0], c[1] - sc[1], c[2] - sc[2]));
        }
      f[v] = best <= tol ? 1 : best >= tol * 1.6 ? 0 : 1 - (best - tol) / (tol * 0.6);
    }
    for (let it = 0; it < 2; it++) {
      const g = new Float32Array(n);
      for (let v = 0; v < n; v++) {
        let sum = f[v]!, k = 1;
        for (const u of nbrs[v]!.keys()) (sum += f[u]!), k++;
        g[v] = Math.max(f[v]! * 0.5, sum / k);
      }
      f = g;
    }
    return f;
  });

  // Distância geodésica (Dijkstra) de cada osso a todos os vértices.
  // Float64: com Float32 o custo da fila (double) sai maior que o guardado e a busca para cedo.
  const dist = Array.from({ length: nb }, () => new Float64Array(n).fill(Infinity));
  for (let b = 0; b < nb; b++) {
    const d = dist[b]!;
    const { head, tail } = bones[b]!;
    const seedR = Math.max(12, avgEdge * 1.5);
    let best = -1, bestD = Infinity;
    const heap: [number, number][] = [];
    const push = (v: number, c: number) => {
      heap.push([c, v]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p]![0] <= heap[i]![0]) break;
        [heap[p], heap[i]] = [heap[i]!, heap[p]!];
        i = p;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i]!, heap[m]!];
          i = m;
        }
      }
      return top;
    };
    for (let v = 0; v < n; v++) {
      const e = segmentDistance(pt(v), head, tail);
      if (e < bestD) (bestD = e), (best = v);
      if (e <= seedR) {
        d[v] = e;
        push(v, e);
      }
    }
    if (!heap.length && best >= 0) {
      d[best] = bestD;
      push(best, bestD);
    }
    while (heap.length) {
      const [c, v] = pop();
      if (c > d[v]!) continue;
      for (const [u, len] of nbrs[v]!) {
        const nc = c + len;
        if (nc < d[u]!) {
          d[u] = nc;
          push(u, nc);
        }
      }
    }
  }

  // Peso bruto, suavização e os 4 maiores.
  const eps = Math.max(2, avgEdge * 0.25);
  let w = Array.from({ length: nb }, (_, b) => {
    const arr = new Float32Array(n);
    for (let v = 0; v < n; v++) {
      const d = dist[b]![v]!;
      arr[v] = Number.isFinite(d) ? (1 / (d + eps) ** 3) * (eligible[b] ? eligible[b]![v]! : 1) : 0;
    }
    return arr;
  });
  // Normaliza antes de suavizar (escalas comparáveis entre vértices).
  const normalizeAll = () => {
    for (let v = 0; v < n; v++) {
      let sum = 0;
      for (let b = 0; b < nb; b++) sum += w[b]![v]!;
      if (sum > 0) for (let b = 0; b < nb; b++) w[b]![v]! /= sum;
    }
  };
  normalizeAll();
  for (let it = 0; it < 3; it++) {
    w = w.map((arr, b) => {
      const out = new Float32Array(n);
      for (let v = 0; v < n; v++) {
        if (eligible[b] && eligible[b]![v]! <= 0) continue;
        let s = 0, k = 0;
        for (const u of nbrs[v]!.keys()) (s += arr[u]!), k++;
        out[v] = (0.5 * arr[v]! + 0.5 * (k ? s / k : arr[v]!)) * (eligible[b] ? eligible[b]![v]! : 1);
      }
      return out;
    });
    normalizeAll();
  }
  const boneIndices = new Uint8Array(n * 4);
  const weights = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const order = Array.from({ length: nb }, (_, b) => b).sort((a, b) => w[b]![v]! - w[a]![v]!);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += k < nb ? w[order[k]!]![v]! : 0;
    if (sum <= 0) {
      // Sem peso nenhum (não deveria acontecer): o osso mais perto em linha reta.
      let best = 0, bd = Infinity;
      for (let b = 0; b < nb; b++) {
        const d = segmentDistance(pt(v), bones[b]!.head, bones[b]!.tail);
        if (d < bd) (bd = d), (best = b);
      }
      boneIndices[v * 4] = best;
      weights[v * 4] = 1;
      continue;
    }
    for (let k = 0; k < 4; k++) {
      const b = order[k] ?? 0;
      boneIndices[v * 4 + k] = b;
      weights[v * 4 + k] = k < nb ? w[b]![v]! / sum : 0;
    }
  }
  return { boneIndices, weights };
}

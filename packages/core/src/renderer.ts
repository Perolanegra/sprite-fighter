import type { Character } from './character.js';
import { deformLBS, skinMatrices } from './deform.js';
import { GLSkinRenderer } from './gl-skin.js';
import type { ImagePose } from './image-pose.js';
import { apply, invert, multiply, rotation, scaling, translation, type Mat2D, type Vec2 } from './math.js';
import type { Skeleton } from './skeleton.js';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function parseColor(c: string): [number, number, number] {
  const hex = c.replace('#', '');
  const full = hex.length === 3 ? [...hex].map((h) => h + h).join('') : hex.padEnd(6, 'f');
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** Garante o bitmap do sprite com pelo menos w × h (cresce, nunca encolhe: sem realocar por quadro). */
function fitSprite(s: Sprite, w: number, h: number): void {
  if (s.canvas.width < w || s.canvas.height < h) {
    s.canvas.width = Math.max(s.canvas.width, Math.ceil(w * 1.2));
    s.canvas.height = Math.max(s.canvas.height, Math.ceil(h * 1.2));
    s.ctx = s.canvas.getContext('2d') as CanvasRenderingContext2D;
  }
  s.w = w;
  s.h = h;
}

export interface Camera {
  /** Centro da vista no mundo. */
  x: number;
  y: number;
  zoom: number;
  /** Giro da vista (rad, tremida). */
  rotation?: number;
}

export interface DrawOptions {
  alpha?: number;
  /** Flash de impacto: a silhueta pintada de uma cor. */
  flash?: { color: string; amount: number } | null;
  /** Deslocamento no mundo (cópias de afterimage/smear). */
  offset?: Vec2;
  /** Transformação extra no mundo, aplicada depois do offset (esticar no borrão). */
  transform?: Mat2D;
}

/** Bitmap de um personagem já renderizado (Canvas 2D): as cópias são só `drawImage` dele. */
export interface Sprite {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  /** Área usada (px do buffer). */
  w: number;
  h: number;
  /** Pixel do bitmap → mundo (a vista na hora da captura, invertida). */
  toWorld: Mat2D;
  /** false = vazio (fora da tela). */
  ok: boolean;
}

/** No navegador, um <canvas> fora da página (mesmo backend do canvas da cena); fora dele, OffscreenCanvas. */
function newCanvas(): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c;
  }
  return new OffscreenCanvas(1, 1);
}

export function createSprite(): Sprite {
  const canvas = newCanvas();
  return { canvas, ctx: canvas.getContext('2d') as CanvasRenderingContext2D, w: 0, h: 0, toWorld: [1, 0, 0, 1, 0, 0], ok: false };
}

/**
 * Algo desenhável várias vezes no mesmo quadro (pose atual, cópias do borrão, afterimages).
 * No WebGL é o próprio esqueleto (cada cópia re-deforma a malha na GPU, barato); no Canvas 2D,
 * um sprite capturado uma vez (as cópias são `drawImage`, sem refazer os triângulos).
 */
export interface Drawable {
  skeleton: Skeleton;
  character: Character;
  sprite: Sprite | null;
  /** Pose a desenhar no lugar da do rig (variante de textura: mesma malha, outra imagem). */
  pose?: ImagePose;
}

/** Osso de maior peso de cada vértice (fallback 2D). */
function dominantBones(pose: ImagePose): Int16Array {
  const { weights: W, boneIndices: I, vertexCount } = pose.mesh;
  const out = new Int16Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (W[v * 4 + k]! > W[v * 4 + best]!) best = k;
    out[v] = I[v * 4 + best]!;
  }
  return out;
}

/** Erro (px do buffer) aceito para desenhar um triângulo só com o osso dominante. */
const RIGID_TOLERANCE = 1;
/** Quanto cada triângulo cresce (px do buffer) no fallback 2D: a borda suavizada não deixa fio. */
const GROW = 1.2;

/**
 * Renderer Canvas 2D: DPR alto, redimensionamento, câmera e desenho dos esqueletos.
 * Coordenadas do mundo em px; a câmera centraliza (x, y) na tela.
 *
 * Poses-imagem com WebGL: os desenhos vão para uma camada GL e são compostos na tela de uma vez
 * (`flush`). Dentro de `batch(fn)` todos os personagens e cópias saem numa composição só (a cópia
 * GL → canvas é o passo caro); fora dele, cada `drawSkeleton` compõe na hora.
 */
export class CanvasRenderer {
  private readonly back: CanvasRenderingContext2D;
  /** Camadas no DOM (`useLayers`): WebGL dos personagens e o 2D da frente, por cima do canvas. */
  private layers: { gl: HTMLCanvasElement; front: HTMLCanvasElement; frontCtx: CanvasRenderingContext2D } | null = null;
  /** Já houve desenho GL neste quadro: o 2D seguinte vai para a camada da frente. */
  private onFront = false;
  /** Tamanho em px CSS. */
  width = 0;
  height = 0;
  dpr = 1;
  camera: Camera = { x: 0, y: 0, zoom: 1 };
  background = '#14151c';
  /** Desenhar poses-imagem com WebGL (false = fallback Canvas 2D). */
  useWebGL = true;
  /**
   * Região escondida: quadrilátero convexo no mundo (4 pontos). O que os personagens desenharem
   * dentro dele some (clip-path de "entrar" numa porta). null = nada escondido.
   */
  hide: Vec2[] | null = null;
  private gl?: GLSkinRenderer | null;
  private mats = new Float32Array(0);
  private deformed = new Float32Array(0);
  private tintSprite: Sprite | null = null;
  private scratch: Sprite | null = null;
  private readonly dominant = new WeakMap<ImagePose, Int16Array>();
  private readonly patterns = new WeakMap<ImagePose, CanvasPattern>();
  private groups: number[][] = [];
  private batching = 0;
  /** Camada GL com desenho pendente e a caixa (px do buffer) que ele ocupa. */
  private pending: { x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2D indisponível');
    this.back = ctx;
  }

  /** Em camadas no DOM? */
  get layered(): boolean {
    return !!this.layers;
  }

  /** Contexto 2D atual: o do canvas da cena ou, depois dos personagens em camadas, o da frente. */
  get ctx(): CanvasRenderingContext2D {
    return this.onFront && this.layers ? this.layers.frontCtx : this.back;
  }

  /**
   * Camadas no DOM (só com WebGL e o canvas numa página): os personagens vão para um canvas
   * WebGL sobreposto e o 2D desenhado depois deles para um canvas da frente. O navegador compõe
   * as camadas: nada de copiar o WebGL para o canvas 2D a cada quadro (o passo mais caro).
   * Devolve false (e fica numa camada só) se não der.
   */
  useLayers(): boolean {
    if (this.layers) return true;
    const parent = this.canvas.parentElement;
    if (!parent || !this.useWebGL || typeof document === 'undefined') return false;
    const make = () => {
      const c = document.createElement('canvas');
      c.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
      return c;
    };
    const gl = make(), front = make();
    const glr = GLSkinRenderer.create(gl);
    if (!glr) return false;
    this.gl = glr;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    this.canvas.after(gl, front);
    this.layers = { gl, front, frontCtx: front.getContext('2d')! };
    this.resize(this.width, this.height, this.dpr);
    return true;
  }

  /**
   * Solta o que o renderer criou: o contexto WebGL (texturas, buffers, shaders), as camadas do DOM
   * e os bitmaps de rascunho. O canvas da cena é de quem chamou e fica (o 2D dele continua válido).
   */
  dispose(): void {
    this.gl?.dispose();
    this.gl = null;
    if (this.layers) {
      this.layers.gl.remove();
      this.layers.front.remove();
      this.layers = null;
    }
    for (const s of [this.scratch, this.tintSprite]) if (s) s.canvas.width = s.canvas.height = 0;
    this.scratch = this.tintSprite = null;
    this.pending = null;
    this.onFront = false;
  }

  /** Ajusta o buffer ao tamanho na tela × DPR. */
  resize(width: number, height: number, dpr = globalThis.devicePixelRatio || 1): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    if (this.layers)
      for (const c of [this.layers.gl, this.layers.front]) {
        c.width = this.canvas.width;
        c.height = this.canvas.height;
        c.style.width = `${width}px`;
        c.style.height = `${height}px`;
        c.style.left = `${this.canvas.offsetLeft}px`;
        c.style.top = `${this.canvas.offsetTop}px`;
      }
  }

  /** Matriz mundo → pixels do buffer. */
  viewMatrix(): Mat2D {
    const { x, y, zoom } = this.camera;
    const s = zoom * this.dpr;
    const m: Mat2D = [s, 0, 0, s, this.width * this.dpr * 0.5 - x * s, this.height * this.dpr * 0.5 - y * s];
    const rot = this.camera.rotation ?? 0;
    if (!rot) return m;
    const cx = this.width * this.dpr * 0.5, cy = this.height * this.dpr * 0.5;
    return multiply(multiply(multiply(translation(cx, cy), rotation(rot)), translation(-cx, -cy)), m);
  }

  /** Converte um ponto da tela (px CSS) para o mundo. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return apply(invert(this.viewMatrix()), { x: sx * this.dpr, y: sy * this.dpr });
  }

  clear(): void {
    this.pending = null;
    this.onFront = false;
    if (this.layers) {
      const f = this.layers.frontCtx;
      f.setTransform(1, 0, 0, 1, 0, 0);
      f.clearRect(0, 0, this.layers.front.width, this.layers.front.height);
      this.gl!.begin(this.canvas.width, this.canvas.height, true);
    }
    const ctx = this.back;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Usa WebGL nas poses-imagem? (false se o navegador não tiver.) */
  get webGL(): boolean {
    if (!this.useWebGL) return false;
    if (this.gl === undefined) this.gl = GLSkinRenderer.create();
    return !!this.gl;
  }

  /**
   * Prepara as poses-imagem carregadas do personagem: sobe texturas e malhas para a GPU (WebGL) ou
   * decodifica as texturas (Canvas 2D). Sem isso, a primeira troca para cada pose engasga no meio da
   * cena. Chamar depois de carregar as poses (ex.: depois de `world.prepare()`).
   */
  preload(character: Character): void {
    for (const pose of [...character.imagePoses.values(), ...character.variantPoses.values()]) {
      if (this.webGL) this.gl!.upload(pose);
      else {
        const s = (this.scratch ??= createSprite());
        fitSprite(s, 2, 2);
        s.ctx.drawImage(pose.texture as CanvasImageSource, 0, 0, 2, 2);
        this.dominant.set(pose, this.dominant.get(pose) ?? dominantBones(pose));
      }
    }
  }

  /** Desenha tudo de `fn` com uma composição GL só, no fim. */
  batch(fn: () => void): void {
    this.batching++;
    try {
      fn();
    } finally {
      if (--this.batching === 0) this.flush();
    }
  }

  /** Compõe na tela o que estiver pendente na camada GL. */
  flush(): void {
    const p = this.pending;
    this.pending = null;
    if (!p || !this.gl) return;
    if (this.layers) {
      // A camada GL já está na tela; o 2D daqui pra frente fica por cima dela.
      this.onFront = true;
      return;
    }
    const W = this.canvas.width, H = this.canvas.height;
    const x0 = Math.max(0, Math.floor(p.x0) - 2), y0 = Math.max(0, Math.floor(p.y0) - 2);
    const x1 = Math.min(W, Math.ceil(p.x1) + 2), y1 = Math.min(H, Math.ceil(p.y1) + 2);
    if (x1 <= x0 || y1 <= y0) return;
    const g = this.gl.region;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.drawImage(this.gl.canvas, g.x + x0, g.y + y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  }

  drawSkeleton(skeleton: Skeleton, character: Character, options: DrawOptions = {}): void {
    this.drawPrepared(this.prepare(skeleton, character, undefined, false), options);
  }

  /**
   * Prepara um esqueleto para ser desenhado. `copies` = vai ser desenhado mais de uma vez neste
   * quadro (borrão, cópias): no Canvas 2D vira um sprite (capturado uma vez, as cópias são
   * `drawImage`); sem cópias, a pose-imagem é desenhada direto na tela (uma passada a menos).
   * No WebGL nunca há sprite: cada desenho re-deforma a malha na GPU. `variant` = desenhar com a
   * textura de uma variante da pose (mesmo rig).
   */
  prepare(skeleton: Skeleton, character: Character, into?: Sprite, copies = true, variant?: ImagePose): Drawable {
    const pose = variant ?? (skeleton.rig.kind === 'image' ? character.imagePoseOf(skeleton.rig) : undefined);
    if (pose && (this.webGL || !copies)) return { skeleton, character, sprite: null, ...(variant ? { pose: variant } : {}) };
    return { skeleton, character, sprite: this.capture(skeleton, character, into ?? (this.scratch ??= createSprite()), variant) };
  }

  /** Desenha o que `prepare` deu, com alpha, deslocamento, esticada e flash. */
  drawPrepared(d: Drawable, options: DrawOptions = {}): void {
    const alpha = options.alpha ?? 1;
    if (alpha <= 0.002) return;
    let world: Mat2D | null = options.transform ?? null;
    if (options.offset) world = multiply(world ?? [1, 0, 0, 1, 0, 0], translation(options.offset.x, options.offset.y));
    const flash = options.flash && options.flash.amount > 0 ? options.flash : null;
    if (d.sprite) return this.drawSprite(d.sprite, alpha, world, flash);
    const pose = d.pose ?? d.character.imagePoseOf(d.skeleton.rig)!;
    const view = world ? multiply(this.viewMatrix(), world) : this.viewMatrix();
    this.skin(d.skeleton, pose);
    if (!this.webGL) {
      // Canvas 2D, sem cópias: direto na tela (com flash, passa pelo sprite, que isola a silhueta).
      if (flash) return this.drawSprite(this.capture(d.skeleton, d.character, (this.scratch ??= createSprite()), d.pose), alpha, world, flash);
      this.flush();
      const dv = deformLBS(pose.mesh, this.mats, pose.origin, this.deformedFor(pose));
      const ctx = this.ctx;
      ctx.save();
      this.clipHide(ctx);
      ctx.globalAlpha = Math.min(1, alpha);
      this.drawTriangles(ctx, pose, dv, view);
      ctx.restore();
      return;
    }
    const gl = this.gl!;
    if (!this.pending && !this.layers) gl.begin(this.canvas.width, this.canvas.height);
    // Caixa na tela (para compor só ela): a malha deformada.
    const dv = deformLBS(pose.mesh, this.mats, pose.origin, this.deformedFor(pose));
    const box = this.pending ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (let i = 0; i < dv.length; i += 2) {
      const x = view[0] * dv[i]! + view[2] * dv[i + 1]! + view[4], y = view[1] * dv[i]! + view[3] * dv[i + 1]! + view[5];
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
    }
    this.pending = box;
    gl.draw(pose, this.mats, view, { alpha, tint: flash ? parseColor(flash.color) : undefined, tintAmount: flash ? Math.min(1, flash.amount) : 0, hide: this.hideLines() });
    if (!this.batching) this.flush();
  }

  private skin(skeleton: Skeleton, pose: ImagePose): void {
    const n = pose.rig.bones.length * 6;
    if (this.mats.length !== n) this.mats = new Float32Array(n);
    skinMatrices(skeleton, pose.restInverse, this.mats);
  }

  private deformedFor(pose: ImagePose): Float32Array<ArrayBuffer> {
    if (this.deformed.length !== pose.mesh.positions.length) this.deformed = new Float32Array(pose.mesh.positions.length);
    return this.deformed;
  }

  /** Renderiza o esqueleto num sprite (bitmap do tamanho da caixa na tela, com a vista atual). */
  capture(skeleton: Skeleton, character: Character, into: Sprite = createSprite(), variant?: ImagePose): Sprite {
    const view = this.viewMatrix();
    const W = this.canvas.width, H = this.canvas.height;
    const pose = variant ?? (skeleton.rig.kind === 'image' ? character.imagePoseOf(skeleton.rig) : undefined);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (wx: number, wy: number) => {
      const x = view[0] * wx + view[2] * wy + view[4], y = view[1] * wx + view[3] * wy + view[5];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    };
    let d: Float32Array<ArrayBuffer> | null = null;
    if (pose) {
      this.skin(skeleton, pose);
      d = deformLBS(pose.mesh, this.mats, pose.origin, this.deformedFor(pose));
      for (let i = 0; i < d.length; i += 2) add(d[i]!, d[i + 1]!);
    } else if (skeleton.rig.kind !== 'image') {
      const inv = 1 / character.atlas.scale;
      for (const item of skeleton.drawList()) {
        const part = character.parts.get(item.part);
        if (!part) continue;
        const m = multiply(item.matrix, scaling(inv));
        for (const [u, v] of [[0, 0], [part.w, 0], [0, part.h], [part.w, part.h]] as const) add(m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]);
      }
    }
    // Margem de 3 px (antisserrilhado); o que sai muito da tela é cortado.
    const pad = 3, extra = Math.max(W, H) * 0.25;
    const bx = Math.floor(Math.max(-extra, x0 - pad)), by = Math.floor(Math.max(-extra, y0 - pad));
    const bw = Math.ceil(Math.min(W + extra, x1 + pad)) - bx, bh = Math.ceil(Math.min(H + extra, y1 + pad)) - by;
    into.ok = bw > 0 && bh > 0 && Number.isFinite(bw + bh);
    if (!into.ok) return into;
    fitSprite(into, bw, bh);
    into.toWorld = multiply(invert(view), translation(bx, by));
    const local = multiply(translation(-bx, -by), view);
    const c = into.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, bw, bh);
    if (pose && d) this.drawTriangles(c, pose, d, local);
    else if (skeleton.rig.kind !== 'image') this.drawParts(c, skeleton, character, local, 1);
    return into;
  }

  /** Desenha um sprite capturado (com alpha, transformação no mundo e flash). */
  drawSprite(sprite: Sprite, alpha = 1, world: Mat2D | null = null, flash: { color: string; amount: number } | null = null): void {
    if (!sprite.ok || alpha <= 0.002) return;
    this.flush(); // o que já foi pro GL fica por baixo
    let m = this.viewMatrix();
    if (world) m = multiply(m, world);
    m = multiply(m, sprite.toWorld);
    let src: HTMLCanvasElement | OffscreenCanvas = sprite.canvas;
    if (flash) {
      // Silhueta pintada: cópia do sprite com a cor por cima (source-atop), só no tamanho dele.
      const t = (this.tintSprite ??= createSprite());
      fitSprite(t, sprite.w, sprite.h);
      t.ctx.setTransform(1, 0, 0, 1, 0, 0);
      t.ctx.globalCompositeOperation = 'source-over';
      t.ctx.globalAlpha = 1;
      t.ctx.clearRect(0, 0, sprite.w, sprite.h);
      t.ctx.drawImage(sprite.canvas, 0, 0, sprite.w, sprite.h, 0, 0, sprite.w, sprite.h);
      t.ctx.globalCompositeOperation = 'source-atop';
      t.ctx.globalAlpha = Math.min(1, flash.amount);
      t.ctx.fillStyle = flash.color;
      t.ctx.fillRect(0, 0, sprite.w, sprite.h);
      t.ctx.globalCompositeOperation = 'source-over';
      t.ctx.globalAlpha = 1;
      src = t.canvas;
    }
    const { ctx } = this;
    ctx.save();
    this.clipHide(ctx);
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(src, 0, 0, sprite.w, sprite.h, 0, 0, sprite.w, sprite.h);
    ctx.restore();
  }

  /** A região escondida em px do buffer (4 pontos) ou null. */
  private hidePoints(): Vec2[] | null {
    if (!this.hide || this.hide.length !== 4) return null;
    const v = this.viewMatrix();
    return this.hide.map((p) => apply(v, p));
  }

  /** WebGL: as 4 retas (a, b, c) da região escondida, com o lado de dentro negativo. */
  private hideLines(): Float32Array | null {
    const pts = this.hidePoints();
    if (!pts) return null;
    const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4;
    const out = new Float32Array(12);
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % 4]!;
      let nx = b.y - a.y, ny = a.x - b.x, c = -(nx * a.x + ny * a.y);
      if (nx * cx + ny * cy + c > 0) [nx, ny, c] = [-nx, -ny, -c];
      out.set([nx, ny, c], i * 3);
    });
    return out;
  }

  /** Canvas 2D: recorta tudo menos a região escondida (chamar entre save/restore). */
  private clipHide(ctx: CanvasRenderingContext2D): void {
    const pts = this.hidePoints();
    if (!pts) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(0, 0, this.canvas.width, this.canvas.height);
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.clip('evenodd');
  }

  /**
   * Fallback 2D: a textura levada ao lugar deformado por afins (padrão de textura, sem recorte).
   * Poucas operações de desenho: os triângulos que, neste quadro, o osso dominante sozinho leva a
   * menos de 1 px da deformação saem num preenchimento por osso (a afim é a do osso); os outros,
   * um a um; todos 1,2 px maiores (cobrem a emenda).
   */
  private drawTriangles(ctx: Ctx2D, pose: ImagePose, d: Float32Array, view: Mat2D): void {
    let dom = this.dominant.get(pose);
    if (!dom) this.dominant.set(pose, (dom = dominantBones(pose)));
    const P = pose.mesh.positions, T = pose.mesh.triangles, m = this.mats, o = pose.origin;
    const k = pose.texture.width / pose.width; // 2 na @2x
    let pattern = this.patterns.get(pose);
    if (!pattern) {
      pattern = ctx.createPattern(pose.texture as CanvasImageSource, 'no-repeat') ?? undefined;
      if (!pattern) return;
      this.patterns.set(pose, pattern);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = pattern;
    const sx = (i: number) => view[0] * d[i * 2]! + view[2] * d[i * 2 + 1]! + view[4];
    const sy = (i: number) => view[1] * d[i * 2]! + view[3] * d[i * 2 + 1]! + view[5];
    // Um triângulo é "rígido" neste quadro se um osso (o dominante de um dos vértices) sozinho
    // leva os três vértices a menos da tolerância da deformação (na tela).
    const tol2 = (RIGID_TOLERANCE / Math.hypot(view[0], view[1])) ** 2;
    const fits = (bone: number, v: number) => {
      const b = bone * 6, x = P[v * 2]! - o.x, y = P[v * 2 + 1]! - o.y;
      const ex = m[b]! * x + m[b + 2]! * y + m[b + 4]! - d[v * 2]!, ey = m[b + 1]! * x + m[b + 3]! * y + m[b + 5]! - d[v * 2 + 1]!;
      return ex * ex + ey * ey <= tol2;
    };
    const groups = this.groups;
    groups.forEach((g) => (g.length = 0));
    const blended: number[] = [];
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t]!, b = T[t + 1]!, c = T[t + 2]!;
      let bone = -1;
      for (const cand of [dom[a]!, dom[b]!, dom[c]!])
        if (fits(cand, a) && fits(cand, b) && fits(cand, c)) {
          bone = cand;
          break;
        }
      if (bone >= 0) (groups[bone] ??= []).push(t);
      else blended.push(t);
    }
    const xs = [0, 0, 0], ys = [0, 0, 0];
    // Grupos: textura → tela = vista · osso · (uv − origem); vértices pelo próprio osso.
    groups.forEach((tris, bone) => {
      if (!tris.length) return;
      const b: Mat2D = [m[bone * 6]!, m[bone * 6 + 1]!, m[bone * 6 + 2]!, m[bone * 6 + 3]!, m[bone * 6 + 4]!, m[bone * 6 + 5]!];
      const t = multiply(multiply(view, b), translation(-o.x, -o.y));
      pattern.setTransform({ a: t[0] / k, b: t[1] / k, c: t[2] / k, d: t[3] / k, e: t[4], f: t[5] });
      // Cada triângulo 1 px maior (fecha a emenda com os grupos vizinhos; dentro do grupo a
      // sobreposição pinta os mesmos texels).
      ctx.beginPath();
      for (const i of tris) {
        let cx = 0, cy = 0;
        for (let j = 0; j < 3; j++) {
          const v = T[i + j]!, u = P[v * 2]!, w = P[v * 2 + 1]!;
          xs[j] = t[0] * u + t[2] * w + t[4];
          ys[j] = t[1] * u + t[3] * w + t[5];
          cx += xs[j]! / 3;
          cy += ys[j]! / 3;
        }
        for (let j = 0; j < 3; j++) {
          const l = Math.hypot(xs[j]! - cx, ys[j]! - cy) || 1;
          const X = xs[j]! + ((xs[j]! - cx) / l) * GROW, Y = ys[j]! + ((ys[j]! - cy) / l) * GROW;
          if (j === 0) ctx.moveTo(X, Y);
          else ctx.lineTo(X, Y);
        }
      }
      ctx.fill('nonzero');
    });
    for (const t of blended) {
      const ia = T[t]!, ib = T[t + 1]!, ic = T[t + 2]!;
      const x0 = sx(ia), y0 = sy(ia), x1 = sx(ib), y1 = sy(ib), x2 = sx(ic), y2 = sy(ic);
      const u0 = P[ia * 2]!, v0 = P[ia * 2 + 1]!, u1 = P[ib * 2]!, v1 = P[ib * 2 + 1]!, u2 = P[ic * 2]!, v2 = P[ic * 2 + 1]!;
      const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
      if (!den) continue;
      // Afim que leva o triângulo da imagem (u, v) ao do buffer (x, y).
      const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / den;
      const c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / den;
      const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / den;
      const dd = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / den;
      const e = x0 - a * u0 - c * v0;
      const f = y0 - b * u0 - dd * v0;
      const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3;
      const grow = (x: number, y: number) => {
        const l = Math.hypot(x - cx, y - cy) || 1;
        return [x + ((x - cx) / l) * GROW, y + ((y - cy) / l) * GROW] as const;
      };
      pattern.setTransform({ a: a / k, b: b / k, c: c / k, d: dd / k, e, f });
      ctx.beginPath();
      ctx.moveTo(...grow(x0, y0));
      ctx.lineTo(...grow(x1, y1));
      ctx.lineTo(...grow(x2, y2));
      ctx.fill();
    }
  }

  private drawParts(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    skeleton: Skeleton,
    character: Character,
    view: Mat2D,
    alpha: number,
  ): void {
    const inv = 1 / character.atlas.scale;
    ctx.globalAlpha = alpha;
    for (const item of skeleton.drawList()) {
      const part = character.parts.get(item.part);
      if (!part) continue;
      const m = multiply(multiply(view, item.matrix), scaling(inv));
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.drawImage(character.image, part.x, part.y, part.w, part.h, 0, 0, part.w, part.h);
    }
    ctx.globalAlpha = 1;
  }
}

import type { Mat2D } from './math.js';
import type { ImagePose } from './image-pose.js';

/** Máximo de ossos por pose no shader (2 vec3 por osso). */
export const MAX_SKIN_BONES = 32;

const VERT = `
attribute vec2 aPos;
attribute vec4 aIdx;
attribute vec4 aW;
uniform vec3 uB[${MAX_SKIN_BONES * 2}];
uniform vec2 uOrigin;
uniform vec3 uV0;
uniform vec3 uV1;
uniform vec2 uSize;
uniform vec2 uTexSize;
varying vec2 vUV;
varying vec2 vPx;
vec2 bone(float i, vec2 p) {
  int k = int(i) * 2;
  vec3 p3 = vec3(p, 1.0);
  return vec2(dot(uB[k], p3), dot(uB[k + 1], p3));
}
void main() {
  vec2 p = aPos - uOrigin;
  vec2 w = aW.x * bone(aIdx.x, p) + aW.y * bone(aIdx.y, p) + aW.z * bone(aIdx.z, p) + aW.w * bone(aIdx.w, p);
  vec3 w3 = vec3(w, 1.0);
  vec2 px = vec2(dot(uV0, w3), dot(uV1, w3));
  gl_Position = vec4(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0, 0.0, 1.0);
  vUV = aPos / uTexSize;
  vPx = px;
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec3 uTint;
uniform float uTintAmount;
uniform float uAlpha;
uniform vec3 uHide[4];
uniform float uHideOn;
varying vec2 vUV;
varying vec2 vPx;
void main() {
  // Região escondida (quadrilátero convexo em px do buffer): "entrar" numa porta.
  if (uHideOn > 0.5) {
    vec3 p = vec3(vPx, 1.0);
    if (dot(uHide[0], p) <= 0.0 && dot(uHide[1], p) <= 0.0 && dot(uHide[2], p) <= 0.0 && dot(uHide[3], p) <= 0.0) discard;
  }
  vec4 c = texture2D(uTex, vUV);
  c.rgb = mix(c.rgb, uTint * c.a, uTintAmount);
  gl_FragColor = c * uAlpha;
}`;

interface PoseBuffers {
  pos: WebGLBuffer;
  idx: WebGLBuffer;
  w: WebGLBuffer;
  tri: WebGLBuffer;
  count: number;
  tex: WebGLTexture;
}

/**
 * Renderizador WebGL mínimo (sem libs) de poses-imagem: skinning linear (LBS) no shader, até 4
 * ossos por vértice. Desenha num canvas próprio do tamanho do buffer; o CanvasRenderer compõe.
 */
export class GLSkinRenderer {
  readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly loc: Record<string, WebGLUniformLocation | null> = {};
  private readonly attr: { pos: number; idx: number; w: number };
  private readonly cache = new Map<ImagePose, PoseBuffers>();
  private readonly bones = new Float32Array(MAX_SKIN_BONES * 6);
  private readonly shaders: WebGLShader[] = [];

  /** null se o navegador não tiver WebGL (aí o CanvasRenderer usa o fallback 2D). */
  /** `target`: canvas na página (camada); aí não precisa preservar o buffer entre quadros. */
  static create(target?: HTMLCanvasElement): GLSkinRenderer | null {
    try {
      const canvas = target ?? (typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1));
      const gl = canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: !target, antialias: false, alpha: true }) as WebGLRenderingContext | null;
      return gl ? new GLSkinRenderer(canvas, gl) : null;
    } catch {
      return null;
    }
  }

  private constructor(canvas: OffscreenCanvas | HTMLCanvasElement, gl: WebGLRenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      this.shaders.push(s);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`programa: ${gl.getProgramInfoLog(p)}`);
    this.program = p;
    for (const u of ['uB', 'uOrigin', 'uV0', 'uV1', 'uSize', 'uTexSize', 'uTex', 'uTint', 'uTintAmount', 'uAlpha', 'uHide', 'uHideOn']) this.loc[u] = gl.getUniformLocation(p, u);
    this.attr = { pos: gl.getAttribLocation(p, 'aPos'), idx: gl.getAttribLocation(p, 'aIdx'), w: gl.getAttribLocation(p, 'aW') };
  }

  /** Sobe malha e textura da pose para a GPU agora (sem esperar o primeiro desenho). */
  upload(pose: ImagePose): void {
    this.buffers(pose);
  }

  private buffers(pose: ImagePose): PoseBuffers {
    let b = this.cache.get(pose);
    if (b) return b;
    const gl = this.gl;
    const buf = (target: number, data: ArrayBufferView) => {
      const id = gl.createBuffer()!;
      gl.bindBuffer(target, id);
      gl.bufferData(target, data as ArrayBufferView<ArrayBuffer>, gl.STATIC_DRAW);
      return id;
    };
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    // A textura pode ser a @2x: as UVs são normalizadas pela 1x (uTexSize), então tanto faz.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pose.texture as TexImageSource);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const m = pose.mesh;
    b = {
      pos: buf(gl.ARRAY_BUFFER, m.positions),
      idx: buf(gl.ARRAY_BUFFER, m.boneIndices),
      w: buf(gl.ARRAY_BUFFER, m.weights),
      tri: buf(gl.ELEMENT_ARRAY_BUFFER, m.triangles),
      count: m.triangles.length,
      tex,
    };
    this.cache.set(pose, b);
    return b;
  }

  /** Esquece os buffers de uma pose (o Pose Lab refaz a malha). */
  forget(pose: ImagePose): void {
    const b = this.cache.get(pose);
    if (!b) return;
    const gl = this.gl;
    for (const id of [b.pos, b.idx, b.w, b.tri]) gl.deleteBuffer(id);
    gl.deleteTexture(b.tex);
    this.cache.delete(pose);
  }

  /**
   * Libera tudo na GPU (buffers, texturas, shaders, programa) e o próprio contexto WebGL
   * (`WEBGL_lose_context`): o navegador tem um limite de contextos vivos. Depois disso não desenha mais.
   */
  dispose(): void {
    for (const pose of [...this.cache.keys()]) this.forget(pose);
    const gl = this.gl;
    gl.deleteProgram(this.program);
    for (const s of this.shaders) gl.deleteShader(s);
    this.shaders.length = 0;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.width = this.canvas.height = 1;
  }

  /** Área de desenho atual (px); fica no canto de baixo do canvas, que só cresce. */
  private size = { w: 1, h: 1 };

  /**
   * Prepara uma área w × h e limpa. O canvas só cresce (redimensionar por quadro realoca);
   * `region` diz onde ler o resultado (coordenadas de imagem do canvas).
   */
  begin(width: number, height: number, exact = false): void {
    if (exact && (this.canvas.width !== width || this.canvas.height !== height)) {
      this.canvas.width = width;
      this.canvas.height = height;
    } else if (this.canvas.width < width || this.canvas.height < height) {
      this.canvas.width = Math.max(this.canvas.width, width);
      this.canvas.height = Math.max(this.canvas.height, height);
    }
    this.size = { w: width, h: height };
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Onde está a área do último `begin` no canvas (origem em cima, à esquerda). */
  get region(): { x: number; y: number; w: number; h: number } {
    return { x: 0, y: this.canvas.height - this.size.h, w: this.size.w, h: this.size.h };
  }

  /**
   * Desenha a pose deformada. `mats` = matrizes de skinning (6 floats por osso, mundo); `view` =
   * mundo → pixels do buffer; `hide` = 4 retas (a, b, c) em px do buffer: o que fica dentro de
   * todas (a·x + b·y + c ≤ 0) não é desenhado.
   */
  draw(pose: ImagePose, mats: Float32Array, view: Mat2D, options: { alpha?: number; tint?: [number, number, number]; tintAmount?: number; hide?: Float32Array | null } = {}): void {
    const gl = this.gl;
    const b = this.buffers(pose);
    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const n = Math.min(MAX_SKIN_BONES, mats.length / 6);
    for (let i = 0; i < n; i++) {
      // [a, b, c, d, e, f] → linhas (a, c, e) e (b, d, f)
      this.bones.set([mats[i * 6]!, mats[i * 6 + 2]!, mats[i * 6 + 4]!, mats[i * 6 + 1]!, mats[i * 6 + 3]!, mats[i * 6 + 5]!], i * 6);
    }
    gl.uniform3fv(this.loc['uB']!, this.bones);
    gl.uniform2f(this.loc['uOrigin']!, pose.origin.x, pose.origin.y);
    gl.uniform3f(this.loc['uV0']!, view[0], view[2], view[4]);
    gl.uniform3f(this.loc['uV1']!, view[1], view[3], view[5]);
    gl.uniform2f(this.loc['uSize']!, this.size.w, this.size.h);
    gl.uniform2f(this.loc['uTexSize']!, pose.width, pose.height);
    const tint = options.tint ?? [1, 1, 1];
    gl.uniform3f(this.loc['uTint']!, tint[0], tint[1], tint[2]);
    gl.uniform1f(this.loc['uTintAmount']!, options.tintAmount ?? 0);
    gl.uniform1f(this.loc['uAlpha']!, options.alpha ?? 1);
    gl.uniform1f(this.loc['uHideOn']!, options.hide ? 1 : 0);
    if (options.hide) gl.uniform3fv(this.loc['uHide']!, options.hide);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, b.tex);
    gl.uniform1i(this.loc['uTex']!, 0);
    const bind = (id: WebGLBuffer, loc: number, size: number, type: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, id);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, false, 0, 0);
    };
    bind(b.pos, this.attr.pos, 2, gl.FLOAT);
    bind(b.idx, this.attr.idx, 4, gl.UNSIGNED_BYTE);
    bind(b.w, this.attr.w, 4, gl.FLOAT);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.tri);
    gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_SHORT, 0);
  }
}

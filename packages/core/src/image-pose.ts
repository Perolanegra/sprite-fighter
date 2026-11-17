import { deg2rad, type Mat2D, type Vec2 } from './math.js';
import { buildSkinMesh, type SkinMesh } from './mesh.js';
import type { SolvedRig } from './rig.js';
import { parseSkin, restMatrices, skinToRig, SKIN_BODY, type SkinSpec } from './skin.js';
import { estimateHurtRadii } from './hurtbox.js';
import { invertAll } from './deform.js';
import type { AtlasImage } from './character.js';
import { DataError } from './validate.js';

/** Pose-imagem pronta pra desenhar: imagem, malha com pesos, rig e o repouso (bind). */
export interface ImagePose {
  name: string;
  spec: SkinSpec;
  /** Imagem 1x (malha e coordenadas). */
  image: AtlasImage;
  /** Textura desenhada (a @2x em telas densas, senão a própria 1x). */
  texture: AtlasImage;
  width: number;
  height: number;
  rig: SolvedRig;
  mesh: SkinMesh;
  /** Inversa do mundo de repouso de cada osso (bind). */
  restInverse: Mat2D[];
  /** Cabeça do osso raiz em px da imagem (vira a origem do personagem). */
  origin: Vec2;
  /** Limite de rotação por osso (rad). */
  limits: Float32Array;
  /** Para cada osso, o índice do osso cuja rotação ele copia (-1 = nenhum). */
  follow: Int16Array;
  /**
   * Deslocamento da raiz (mundo, olhando pra direita) que põe o pescoço desta pose no mesmo
   * lugar do pescoço do rig de peças: a troca de skin não "pula". Definido pelo Character.
   */
  anchor: Vec2;
  /** Raio da hurtbox de cada osso (px da imagem; 0 = sem hurtbox). */
  hurtRadii: Float32Array;
  /**
   * Pose provisória: usa a imagem de outra pose (`from`) com uma variação na raiz, até chegar a
   * imagem de verdade. O debug marca "PROVISÓRIA".
   */
  provisional?: ProvisionalSpec;
  /** Alfa da imagem 1x (silhueta), para conferir variantes. */
  alpha: Uint8ClampedArray;
  /**
   * Variante de textura (`<pose>@<variante>`): mesma malha, pesos e esqueleto da pose base, só a
   * imagem muda. `name` continua o da base.
   */
  variant?: string;
}

/** Diferença de silhueta acima da qual a variante gera aviso (fração da área da base). */
export const VARIANT_SILHOUETTE_WARN = 0.03;

/**
 * Compara duas silhuetas do mesmo tamanho (alfa ≥ 128): `diff` = pixels que só uma delas tem ÷ área
 * da base; `shift` = deslocamento do centro de massa (px). Pura.
 */
export function silhouetteDiff(base: Uint8ClampedArray, other: Uint8ClampedArray, width: number): { diff: number; shift: { x: number; y: number } } {
  let area = 0, xor = 0, ax = 0, ay = 0, bx = 0, by = 0, bn = 0;
  for (let i = 0; i < base.length; i++) {
    const a = base[i]! >= 128, b = other[i]! >= 128;
    const x = i % width, y = (i - x) / width;
    if (a) {
      area++;
      ax += x;
      ay += y;
    }
    if (b) {
      bn++;
      bx += x;
      by += y;
    }
    if (a !== b) xor++;
  }
  const shift = area && bn ? { x: bx / bn - ax / area, y: by / bn - ay / area } : { x: 0, y: 0 };
  return { diff: area ? xor / area : 1, shift };
}

/**
 * Variante de textura de uma pose: reusa esqueleto, malha, pesos e rig da `base` e troca só a
 * imagem. Exige o mesmo tamanho (mesmo enquadramento); devolve também a diferença de silhueta
 * (aviso acima de `VARIANT_SILHOUETTE_WARN`: imagem desalinhada ou figura diferente demais).
 */
export function buildVariant(
  base: ImagePose,
  variant: string,
  image: AtlasImage,
  rgba: Uint8ClampedArray,
  texture: AtlasImage = image,
): { pose: ImagePose; diff: number; shift: { x: number; y: number } } {
  const source = `variante ${base.name}@${variant}`;
  if (base.provisional) throw new DataError(source, '', `"${base.name}" é provisória: variantes só em poses com imagem`);
  if (image.width !== base.width || image.height !== base.height)
    throw new DataError(source, '', `tamanho ${image.width}×${image.height} diferente da base ${base.width}×${base.height}: a variante precisa do mesmo enquadramento da pose "${base.name}"`);
  const alpha = new Uint8ClampedArray(base.width * base.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]!;
  const { diff, shift } = silhouetteDiff(base.alpha, alpha, base.width);
  return { pose: { ...base, image, texture, alpha, variant }, diff, shift };
}

/** Variação de uma pose provisória (graus e px do mundo, olhando pra direita). */
export interface ProvisionalSpec {
  from: string;
  rotate: number;
  sx: number;
  sy: number;
  dx: number;
  dy: number;
}

/** Monta a pose a partir do skin.json e dos pixels da imagem (RGBA). Pura: serve pro Node também. */
export function buildImagePose(
  skinJson: unknown,
  image: AtlasImage,
  rgba: Uint8ClampedArray,
  options: { source?: string; expected?: Map<string, string | null>; texture?: AtlasImage } = {},
): ImagePose {
  const spec = parseSkin(skinJson, { width: image.width, height: image.height }, options.source ?? 'skin', options.expected);
  return assembleImagePose(spec, image, rgba, options.texture);
}

/** Refaz malha/pesos/bind para um spec (o Pose Lab chama ao mover articulações). */
export function assembleImagePose(spec: SkinSpec, image: AtlasImage, rgba: Uint8ClampedArray, texture: AtlasImage = image): ImagePose {
  const w = image.width, h = image.height;
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]!;
  const cloth = new Set(spec.chains.flatMap((c) => c.bones));
  const mesh = buildSkinMesh({
    width: w,
    height: h,
    alpha,
    rgba,
    bones: spec.bones.map((b) => ({ head: b.head, tail: b.tail, cloth: cloth.has(b.name) })),
    target: spec.mesh.target,
    boundaryStep: spec.mesh.boundaryStep,
    seed: spec.mesh.seed,
    clothTolerance: spec.mesh.clothTolerance,
  });
  return {
    name: spec.pose,
    spec,
    image,
    texture,
    width: w,
    height: h,
    rig: skinToRig(spec),
    mesh,
    restInverse: invertAll(restMatrices(spec)),
    origin: { ...spec.bones.find((b) => b.parent === null)!.head },
    limits: Float32Array.from(spec.bones.map((b) => deg2rad(b.limit))),
    anchor: { x: 0, y: 0 },
    hurtRadii: estimateHurtRadii(
      alpha,
      w,
      h,
      spec.bones.map((b) => ({ head: b.head, tail: b.tail, body: BODY.has(b.name) })),
    ),
    follow: Int16Array.from(spec.bones.map((b) => (b.follow ? spec.bones.findIndex((o) => o.name === b.follow) : -1))),
    alpha,
  };
}

const BODY = new Set(SKIN_BODY.map(([n]) => n));

/** Pose provisória: a mesma imagem/malha de `base`, com nome e rig próprios (o renderer acha a malha pelo rig). */
export function provisionalPose(name: string, base: ImagePose, variation: ProvisionalSpec): ImagePose {
  return { ...base, name, rig: skinToRig(base.spec), anchor: { ...base.anchor }, provisional: variation };
}

/** Ossos (nome → mãe) de uma pose: as outras poses do personagem precisam ter os mesmos. */
export const boneSignature = (pose: ImagePose) => new Map(pose.spec.bones.map((b) => [b.name, b.parent]));

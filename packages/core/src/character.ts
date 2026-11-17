import { parseAtlas, type AtlasData, type AtlasPart } from './atlas.js';
import { PartGeometry, opaquePoints } from './geometry.js';
import { VARIANT_SILHOUETTE_WARN, boneSignature, buildImagePose, buildVariant, provisionalPose, type ImagePose, type ProvisionalSpec } from './image-pose.js';
import { parseRig, solveRig, type RigSpec, type SolvedRig } from './rig.js';
import { Skeleton } from './skeleton.js';
import { parseManifest, type CharacterManifest, type VariantMeta } from './manifest.js';

/** Skin ativa: a pose-imagem (voo…) ou o rig de peças (golpes). */
export type SkinKind = 'image' | 'parts';
/** Como mascarar a troca de skin/pose. */
export type PoseTransition = 'afterimage' | 'flash' | 'smear' | 'cut';

export interface SkinChange {
  skin: SkinKind;
  pose: string;
  transition: PoseTransition;
}

/** Índice das poses-imagem de um personagem (`assets/skins/<char>.json`). */
export interface PoseIndex {
  default: string;
  /** Pasta das poses, relativa a assets/ (ex.: poses/<coleção>/<id>; termina no id). */
  dir: string;
  poses: string[];
  /**
   * Poses provisórias (ainda sem imagem): nome → variação de uma pose existente.
   *   "provisional": { "dodge": { "from": "fly", "rotate": -28, "sx": 0.9, "sy": 1.08, "dy": -20 } }
   */
  provisional: Record<string, ProvisionalSpec>;
  /** Variantes de textura por pose (ver manifest.ts). */
  variants?: Record<string, VariantMeta[]>;
}

/** Transição padrão de uma troca de pose: smear na ida, afterimage na volta para a pose base. */
export function defaultTransition(to: string, base: string | undefined): PoseTransition {
  return to === base ? 'afterimage' : 'smear';
}

/** Imagem desenhável no canvas (HTMLImageElement, ImageBitmap, canvas…). */
export type AtlasImage = CanvasImageSource & { width: number; height: number };

/**
 * Personagem carregado: atlas (imagem + recortes), geometria de cada peça e o rig resolvido.
 * Cria quantos esqueletos (instâncias) forem precisos.
 */
export class Character {
  readonly parts: Map<string, AtlasPart>;
  /** Poses-imagem carregadas (nome → pose). */
  readonly imagePoses = new Map<string, ImagePose>();
  poseIndex: PoseIndex | null = null;
  /** Manifesto completo (descrição do personagem, descrição e tags das poses), quando carregado por URL. */
  manifest: CharacterManifest | null = null;
  /** Skin e pose-imagem atuais (os actors deste personagem seguem). */
  skin: SkinKind = 'parts';
  pose = '';
  private readonly listeners = new Set<(change: SkinChange) => void>();
  /** Carrega uma pose-imagem pelo nome (o Character.load preenche no navegador; em Node, quem carrega). */
  loadImagePose?: (name: string) => Promise<ImagePose>;
  /** Carrega a imagem de uma variante (`<pose>@<variante>`) e devolve imagem 1x, pixels e textura. */
  loadVariantImage?: (pose: string, variant: string) => Promise<{ image: AtlasImage; rgba: Uint8ClampedArray; texture?: AtlasImage }>;
  /** Variantes carregadas ("<pose>@<variante>" → pose com a outra textura). */
  readonly variantPoses = new Map<string, ImagePose>();
  /** Avisos de carga (variante desalinhada…). Padrão: console.warn. */
  onWarning: (message: string) => void = (m) => console.warn(m);

  constructor(
    readonly atlas: AtlasData,
    readonly image: AtlasImage,
    readonly geometry: Map<string, PartGeometry>,
    readonly rigSpec: RigSpec,
    readonly rig: SolvedRig,
  ) {
    this.parts = new Map(atlas.parts.map((p) => [p.name, p]));
  }

  get name(): string {
    return this.atlas.char;
  }

  /** O rig de uma skin/pose ("parts" ou o nome da pose-imagem). */
  rigFor(skin: SkinKind, pose = this.pose): SolvedRig {
    if (skin === 'parts') {
      if (!this.hasParts) throw new Error(`${this.name} foi carregado só com poses-imagem: não tem a skin "parts"`);
      return this.rig;
    }
    const p = this.imagePoses.get(pose);
    if (!p) throw new Error(`pose-imagem "${pose}" de ${this.name} não carregada`);
    return p.rig;
  }

  /** Pose-imagem que usa este rig (o renderer acha a malha a partir do esqueleto). */
  imagePoseOf(rig: SolvedRig): ImagePose | undefined {
    for (const p of this.imagePoses.values()) if (p.rig === rig) return p;
    return undefined;
  }

  /** Acrescenta uma pose-imagem já montada (valida: mesmos ossos das outras poses). */
  addImagePose(pose: ImagePose): void {
    const other = [...this.imagePoses.values()].find((p) => p.name !== pose.name);
    if (other) {
      const a = boneSignature(other), b = boneSignature(pose);
      const same = a.size === b.size && [...a].every(([n, parent]) => b.get(n) === parent);
      if (!same) throw new Error(`pose "${pose.name}" de ${this.name}: os ossos precisam ser os mesmos da pose "${other.name}"`);
    }
    // Âncora: entre poses-imagem, o quadril (raiz) fica no mesmo lugar, então todas usam a âncora
    // da pose padrão. A padrão alinha o pescoço com o do rig de peças (troca image ↔ parts).
    const def = this.poseIndex ? this.imagePoses.get(this.poseIndex.default) : undefined;
    const partsHead = this.hasParts ? this.rig.byName.get('head') : undefined;
    const imageHead = pose.spec.bones.find((b) => b.name === 'head');
    if (def && def !== pose) pose.anchor = { ...def.anchor };
    else if (partsHead !== undefined && imageHead) {
      const parts = new Skeleton(this.rig).pivotWorld(partsHead);
      const k = pose.spec.scale;
      pose.anchor = { x: parts.x - (imageHead.head.x - pose.origin.x) * k, y: parts.y - (imageHead.head.y - pose.origin.y) * k };
    }
    this.imagePoses.set(pose.name, pose);
    if (!this.pose) this.pose = pose.name;
  }

  /** Pose base (a padrão do índice, o voo). */
  get basePose(): string | undefined {
    return this.poseIndex?.default;
  }

  /** Poses que este personagem conhece: as do índice e as provisórias. */
  availablePoses(): Set<string> {
    return new Set([...(this.poseIndex?.poses ?? []), ...Object.keys(this.poseIndex?.provisional ?? {}), ...this.imagePoses.keys()]);
  }

  /** Variantes declaradas de uma pose (as provisórias não têm). */
  variantsOf(pose: string): VariantMeta[] {
    return this.poseIndex?.variants?.[pose] ?? [];
  }

  /** Poses que têm a variante `name` (do tipo `kind`, se dado). */
  posesWithVariant(name: string, kind?: string): string[] {
    return Object.entries(this.poseIndex?.variants ?? {})
      .filter(([, vs]) => vs.some((v) => v.name === name && (!kind || v.kind === kind)))
      .map(([p]) => p);
  }

  /**
   * Carrega a variante `<pose>@<variant>` (a pose base é carregada antes). Tamanho diferente da base
   * é erro; silhueta mais de 3 % diferente gera aviso (`onWarning`).
   */
  async loadVariant(pose: string, variant: string): Promise<ImagePose> {
    const key = `${pose}@${variant}`;
    const have = this.variantPoses.get(key);
    if (have) return have;
    if (!this.variantsOf(pose).some((v) => v.name === variant)) throw new Error(`${this.name}: a pose "${pose}" não tem a variante "${variant}" no manifesto`);
    if (!this.loadVariantImage) throw new Error(`${this.name}: sem carregador de variantes`);
    const base = await this.loadPose(pose);
    const { image, rgba, texture } = await this.loadVariantImage(pose, variant);
    const v = buildVariant(base, variant, image, rgba, texture);
    if (v.diff > VARIANT_SILHOUETTE_WARN)
      this.onWarning(
        `variante ${this.name}/${key}: silhueta ${(v.diff * 100).toFixed(1)} % diferente da base (centro deslocado ${v.shift.x.toFixed(1)}, ${v.shift.y.toFixed(1)} px); confira o alinhamento`,
      );
    this.variantPoses.set(key, v.pose);
    return v.pose;
  }

  /** Carrega uma pose-imagem do índice (as que ainda não foram carregadas), inclusive as provisórias. */
  async loadPose(name: string): Promise<ImagePose> {
    const have = this.imagePoses.get(name);
    if (have) return have;
    const variation = this.poseIndex?.provisional[name];
    if (variation) {
      const pose = provisionalPose(name, await this.loadPose(variation.from), variation);
      this.addImagePose(pose);
      return pose;
    }
    if (!this.loadImagePose || !this.poseIndex?.poses.includes(name)) throw new Error(`pose "${name}" não está no índice de ${this.name} (nem em "provisional")`);
    const pose = await this.loadImagePose(name);
    this.addImagePose(pose);
    return pose;
  }

  /** Avisos de troca de skin/pose (os actors escutam). */
  onSkinChange(fn: (change: SkinChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** "image" (pose-imagem atual, o voo) ou "parts" (rig de peças, os golpes), com a troca mascarada. */
  setSkin(skin: SkinKind, options: { transition?: PoseTransition } = {}): void {
    if (skin === 'parts') this.rigFor('parts');
    if (skin === 'image' && !this.imagePoses.has(this.pose)) throw new Error(`${this.name} não tem pose-imagem carregada`);
    if (skin === this.skin) return;
    this.skin = skin;
    this.emit(options.transition ?? 'smear');
  }

  /** Escolhe a pose-imagem (e passa pra skin "image"). "parts" equivale a setSkin('parts'). */
  setPose(name: string, options: { transition?: PoseTransition } = {}): void {
    if (name === 'parts') return this.setSkin('parts', options);
    if (!this.imagePoses.has(name)) throw new Error(`pose-imagem "${name}" de ${this.name} não carregada (use loadPose)`);
    if (this.skin === 'image' && this.pose === name) return;
    this.pose = name;
    this.skin = 'image';
    this.emit(options.transition ?? defaultTransition(name, this.basePose));
  }

  private emit(transition: PoseTransition): void {
    const change = { skin: this.skin, pose: this.pose, transition };
    for (const fn of this.listeners) fn(change);
  }

  createSkeleton(): Skeleton {
    return new Skeleton(this.rig);
  }

  /** Monta a partir dos dados já carregados. `alphaOf` dá o alfa de cada recorte (para o PCA). */
  static fromData(
    atlasJson: unknown,
    rigJson: unknown,
    image: AtlasImage,
    alphaOf: (part: AtlasPart) => Uint8ClampedArray,
  ): Character {
    const atlas = parseAtlas(atlasJson, `atlas ${(atlasJson as { char?: string })?.char ?? ''}`.trim());
    const geometry = new Map<string, PartGeometry>();
    const geoOf = (name: string) => {
      let g = geometry.get(name);
      if (!g) {
        const part = atlas.parts.find((p) => p.name === name)!;
        // O rig trabalha na escala da folha: com upscale, os pontos são reduzidos.
        const pts = opaquePoints(alphaOf(part), part.w, part.h, 128, Math.max(1, Math.round(atlas.scale)));
        for (let i = 0; i < pts.length; i++) pts[i]! /= atlas.scale;
        g = new PartGeometry(pts);
        geometry.set(name, g);
      }
      return g;
    };
    const spec = parseRig(rigJson, new Set(atlas.parts.map((p) => p.name)), `rig ${atlas.char}`);
    return new Character(atlas, image, geometry, spec, solveRig(spec, geoOf));
  }

  /** Tem rig de peças? (false = carregado só com poses-imagem.) */
  get hasParts(): boolean {
    return this.atlas.parts.length > 0;
  }

  /**
   * Carrega por URL (navegador). Só com poses-imagem (o modo principal):
   *   Character.load({ poses: 'skins/<id>.json' })        // id = nome do arquivo (ou `id`)
   * Com o rig de peças também: `{ atlas, rig, poses? }` (imagem do atlas ao lado do JSON).
   * A pose padrão do manifesto já vem carregada; as outras, sob demanda (`loadPose`).
   */
  static async load(urls: { poses: string; atlas?: string; rig?: string; id?: string } | { atlas: string; rig: string; poses?: string }): Promise<Character> {
    if (!urls.atlas || !urls.rig) return Character.loadPoses(urls.poses!, (urls as { id?: string }).id);
    const [atlasJson, rigJson] = await Promise.all([fetchJson(urls.atlas), fetchJson(urls.rig)]);
    const imageUrl = new URL((atlasJson as { image: string }).image, new URL(urls.atlas, location.href)).href;
    const image = await loadImage(imageUrl);
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    const character = Character.fromData(atlasJson, rigJson, image, (part) => {
      const { data } = ctx.getImageData(part.x, part.y, part.w, part.h);
      const alpha = new Uint8ClampedArray(part.w * part.h);
      for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
      return alpha;
    });
    if (urls.poses) {
      const { manifest, loaders } = await poseLoaders(urls.poses, character.name, () => character);
      character.attachPoses(manifest, loaders);
      await character.loadPose(manifest.default);
    }
    return character;
  }

  /** Só poses-imagem, por URL (navegador). */
  private static async loadPoses(posesUrl: string, id?: string): Promise<Character> {
    const name = id ?? posesUrl.split('/').pop()!.replace(/\.json$/, '');
    let character: Character | undefined;
    const { manifest, loaders } = await poseLoaders(posesUrl, name, () => character);
    character = await Character.fromPoses(manifest, loaders);
    return character;
  }

  /**
   * Só poses-imagem, a partir do manifesto já lido e de carregadores próprios (também em Node, sem
   * navegador): o rig do personagem é o da pose padrão e não há skin "parts".
   */
  static async fromPoses(manifest: CharacterManifest, loaders: PoseLoaders): Promise<Character> {
    const name = manifest.id;
    const pose = await loaders.loadImagePose(manifest.default);
    const atlas: AtlasData = { char: name, image: '', width: 0, height: 0, scale: 1, parts: [] };
    const rigSpec: RigSpec = { char: name, tilt: 0, bones: [], caps: [], chains: [] };
    const character = new Character(atlas, { width: 0, height: 0 } as AtlasImage, new Map(), rigSpec, pose.rig);
    character.attachPoses(manifest, loaders);
    character.addImagePose(pose);
    character.skin = 'image';
    return character;
  }

  private attachPoses(manifest: CharacterManifest, loaders: PoseLoaders): void {
    this.manifest = manifest;
    this.poseIndex = {
      default: manifest.default,
      dir: manifest.dir,
      poses: manifest.poses.map((p) => p.name),
      provisional: manifest.provisional,
      variants: Object.fromEntries(manifest.poses.filter((p) => p.variants.length).map((p) => [p.name, p.variants])),
    };
    this.loadImagePose = loaders.loadImagePose;
    this.loadVariantImage = loaders.loadVariantImage;
  }
}

/** Carregadores das poses-imagem e das variantes de um personagem. */
export interface PoseLoaders {
  loadImagePose: (name: string) => Promise<ImagePose>;
  loadVariantImage: NonNullable<Character['loadVariantImage']>;
}

/**
 * Lê o manifesto (`assets/skins/<id>.json`) e monta os carregadores das poses:
 * assets/<dir>/<pose>.webp (+ @2x só com DPR > 1,5) e <pose>.skin.json. `current` dá o personagem
 * já criado (para conferir os ossos contra as poses carregadas).
 */
async function poseLoaders(posesUrl: string, id: string, current: () => Character | undefined): Promise<{ manifest: CharacterManifest; loaders: PoseLoaders }> {
  const indexUrl = new URL(posesUrl, location.href);
  const manifest = parseManifest(await fetchJson(indexUrl.href), id);
  const { dir } = manifest;
  const assets = new URL('../', indexUrl);
  const dense = () => (globalThis.devicePixelRatio || 1) > 1.5;
  const pixels = (img: HTMLImageElement) => {
    const c = new OffscreenCanvas(img.width, img.height);
    const cx = c.getContext('2d', { willReadFrequently: true })!;
    cx.drawImage(img, 0, 0);
    return cx.getImageData(0, 0, img.width, img.height).data;
  };
  const loadImagePose = async (name: string) => {
    const skinUrl = new URL(`${dir}/${name}.skin.json`, assets).href;
    const skinJson = (await fetchJson(skinUrl)) as { image?: string; image2x?: string };
    const img = await loadImage(new URL(skinJson.image ?? `${name}.webp`, skinUrl).href);
    // A malha e as coordenadas usam sempre a 1x.
    const texture = dense() && skinJson.image2x ? await loadImage(new URL(skinJson.image2x, skinUrl).href) : img;
    const other = [...(current()?.imagePoses.values() ?? [])][0];
    return buildImagePose(skinJson, img, pixels(img), {
      source: `pose ${id}/${name}`,
      expected: other ? boneSignature(other) : undefined,
      texture,
    });
  };
  // Variante: <pose>@<variante>.webp ao lado da pose (e a @2x se a pose base tiver @2x).
  const loadVariantImage = async (pose: string, variant: string) => {
    const base = current()!.imagePoses.get(pose)!;
    const img = await loadImage(new URL(`${dir}/${pose}@${variant}.webp`, assets).href);
    const texture = dense() && base.texture !== base.image ? await loadImage(new URL(`${dir}/${pose}@${variant}@2x.webp`, assets).href).catch(() => img) : img;
    return { image: img, rgba: pixels(img), texture };
  };
  return { manifest, loaders: { loadImagePose, loadVariantImage } };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`não foi possível carregar ${url} (${res.status})`);
  return res.json();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`não foi possível carregar a imagem ${url}`));
    img.src = url;
  });
}

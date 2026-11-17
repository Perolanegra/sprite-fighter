import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { Character, boneSignature, buildImagePose, parseClip, parseManifest, parseMoves, type AtlasImage, type CastMember, type ClipData, type PoseLoaders } from '@perolanegra/sprite-fighter';

/**
 * Personagens em Node (sem navegador), para a simulação seca do diretor: só poses-imagem
 * (`Character.fromPoses`) ou, quem tem, também atlas e rig de peças (`Character.fromData`); poses-imagem e variantes decodificadas com sharp e montadas por
 * `buildImagePose` (puro). Só a geometria interessa: a "imagem" é só o tamanho.
 */
const json = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as unknown;

async function rgbaOf(file: string): Promise<{ image: AtlasImage; rgba: Uint8ClampedArray }> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { image: { width: info.width, height: info.height } as AtlasImage, rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

export async function loadCharacterNode(assetsDir: string, id: string): Promise<Character> {
  const manifest = parseManifest(json(join(assetsDir, 'skins', `${id}.json`)), id);
  const dir = join(assetsDir, manifest.dir);
  let character: Character | undefined;
  const loaders: PoseLoaders = {
    loadImagePose: async (name) => {
      const skinJson = json(join(dir, `${name}.skin.json`)) as { image?: string };
      const { image, rgba } = await rgbaOf(join(dir, skinJson.image ?? `${name}.webp`));
      const other = character ? [...character.imagePoses.values()][0] : undefined;
      return buildImagePose(skinJson, image, rgba, { source: `pose ${id}/${name}`, ...(other ? { expected: boneSignature(other) } : {}) });
    },
    loadVariantImage: (pose, variant) => rgbaOf(join(dir, `${pose}@${variant}.webp`)),
  };
  // Só poses-imagem (o modo principal), ou também o rig de peças, se o personagem tiver atlas e rig.
  const atlasFile = join(assetsDir, 'atlas', `${id}.atlas.json`), rigFile = join(assetsDir, 'rigs', `${id}.rig.json`);
  if (!existsSync(atlasFile) || !existsSync(rigFile)) return (character = await Character.fromPoses(manifest, loaders));

  const atlasJson = json(atlasFile) as { image: string };
  const sheet = await sharp(join(assetsDir, 'atlas', atlasJson.image)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = sheet.info.width;
  character = Character.fromData(atlasJson, json(rigFile), { width: W, height: sheet.info.height } as AtlasImage, (part) => {
    const alpha = new Uint8ClampedArray(part.w * part.h);
    for (let y = 0; y < part.h; y++) for (let x = 0; x < part.w; x++) alpha[y * part.w + x] = sheet.data[((part.y + y) * W + part.x + x) * 4 + 3]!;
    return alpha;
  });
  character.manifest = manifest;
  character.poseIndex = {
    default: manifest.default,
    dir: manifest.dir,
    poses: manifest.poses.map((p) => p.name),
    provisional: manifest.provisional,
    variants: Object.fromEntries(manifest.poses.filter((p) => p.variants.length).map((p) => [p.name, p.variants])),
  };
  character.loadImagePose = loaders.loadImagePose;
  character.loadVariantImage = loaders.loadVariantImage;
  await character.loadPose(manifest.default);
  return character;
}

/** Elenco para o Director (personagens + golpes) e os clipes. */
export async function loadCast(assetsDir: string, ids: string[]): Promise<{ characters: Map<string, CastMember>; clips: Map<string, ClipData> }> {
  const characters = new Map<string, CastMember>();
  for (const id of ids) {
    const movesFile = join(assetsDir, 'moves', `${id}.moves.json`);
    characters.set(id, { character: await loadCharacterNode(assetsDir, id), moves: existsSync(movesFile) ? parseMoves(json(movesFile), `golpes ${id}`) : new Map() });
  }
  const clips = new Map<string, ClipData>();
  for (const c of json(join(assetsDir, 'clips', 'index.json')) as string[]) clips.set(c, parseClip(json(join(assetsDir, 'clips', `${c}.json`)), `clip ${c}`));
  return { characters, clips };
}

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPoseAdd } from './add.js';

/** Figura: corpo preto 200×60 com um "braço" 60×12 à direita (a parte que a variante tira). */
async function png(file: string, o: { arm?: boolean; dx?: number; w?: number } = {}): Promise<void> {
  const W = o.w ?? 400, H = 200, dx = o.dx ?? 0;
  const px = Buffer.alloc(W * H * 3, 255);
  const fill = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0 + dx; x < x0 + dx + w; x++) if (x >= 0 && x < W) px.fill(20, (y * W + x) * 3, (y * W + x) * 3 + 3);
  };
  fill(80, 70, 200, 60);
  if (o.arm !== false) fill(280, 90, 12, 12);
  await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toFile(file);
}

let root: string;
let log: string[];
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'sf-add-'));
  const dir = join(root, 'assets/poses/col/hero');
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(root, 'assets/skins'), { recursive: true });
  writeFileSync(join(root, 'assets/skins/hero.json'), JSON.stringify({ default: 'fly', dir: 'poses/col/hero', poses: [{ name: 'fly', description: 'voando', tags: [] }] }));
  await png(join(dir, 'src/fly.png'));
  log = [];
  vi.spyOn(console, 'log').mockImplementation((m: string) => void log.push(String(m)));
  vi.spyOn(console, 'warn').mockImplementation((m: string) => void log.push(String(m)));
  // A pose base, pelo mesmo comando.
  await runPoseAdd(['--char', 'hero', '--pose', 'fly', '--src', join(dir, 'src/fly.png'), '--replace'], root);
});
afterEach(() => vi.restoreAllMocks());

describe('pose:add --variant', () => {
  it('recorta no enquadramento da base, grava e registra no manifesto', async () => {
    const src = join(root, 'nobraço.png');
    await png(src, { arm: false });
    await runPoseAdd(['--char', 'hero', '--pose', 'fly', '--variant', 'noarm', '--kind', 'hand', '--src', src, '--description', 'sem o braço', '--tags', 'Mão'], root);
    const dir = join(root, 'assets/poses/col/hero');
    const [b, v] = await Promise.all([sharp(join(dir, 'fly.webp')).metadata(), sharp(join(dir, 'fly@noarm.webp')).metadata()]);
    expect([v.width, v.height]).toEqual([b.width, b.height]); // sem o braço, a figura é menor, mas a caixa é a da base
    expect(existsSync(join(dir, 'src/fly@noarm.png'))).toBe(true);
    const m = JSON.parse(readFileSync(join(root, 'assets/skins/hero.json'), 'utf8'));
    expect(m.poses[0].variants).toEqual([{ name: 'noarm', kind: 'hand', description: 'sem o braço', tags: ['mão'] }]);
    expect(log.join('\n')).not.toMatch(/AVISO/);
  });

  it('avisa quando a silhueta muda mais de 3 % (desalinhada)', async () => {
    const src = join(root, 'torta.png');
    await png(src, { dx: 20 });
    await runPoseAdd(['--char', 'hero', '--pose', 'fly', '--variant', 'torta', '--kind', 'expression', '--src', src], root);
    expect(log.join('\n')).toMatch(/fly@torta: .* silhueta \d+\.\d % diferente da base/);
    expect(log.join('\n')).toMatch(/AVISO: a silhueta muda mais de 3 %/);
  });

  it('erros claros: tamanho que não bate, repetida, sem --kind, nome reservado', async () => {
    const src = join(root, 'outra.png');
    await png(src, { w: 420 });
    const add = (...a: string[]) => runPoseAdd(['--char', 'hero', '--pose', 'fly', '--src', src, ...a], root);
    await expect(add('--variant', 'x', '--kind', 'hand')).rejects.toThrow(/tamanho da imagem de origem da pose \(src\/fly\.png, 400×200\)/);
    await png(src, { arm: false });
    await add('--variant', 'x', '--kind', 'hand');
    await expect(add('--variant', 'x', '--kind', 'hand')).rejects.toThrow(/fly@x já existe \(use --replace/);
    await expect(add('--variant', 'y')).rejects.toThrow(/--kind expression\|hand/);
    await expect(add('--variant', '2x', '--kind', 'hand')).rejects.toThrow(/nome de variante inválido "2x"/);
    await expect(runPoseAdd(['--char', 'hero', '--pose', 'kick', '--variant', 'x', '--kind', 'hand', '--src', src], root)).rejects.toThrow(/não tem a pose "kick"/);
  });
});

describe('pose:add: primeira pose de um personagem novo', () => {
  beforeEach(() => {
    // Esqueleto da pose base do personagem que já existe (cabeça de 30 px × scale 2 = 60 px no mundo).
    const skin = { version: 1, char: 'hero', pose: 'fly', image: 'fly.webp', scale: 2, measure: { headTop: [10, 10], chin: [10, 40] }, mesh: { target: 200, boundaryStep: 5, seed: 1 }, bones: [{ name: 'hips', parent: null, head: [20, 30], tail: [60, 30], limit: 12 }], chains: [] };
    writeFileSync(join(root, 'assets/poses/col/hero/fly.skin.json'), JSON.stringify(skin));
    // Manifesto escrito antes da imagem (é dele que sai o prompt da primeira pose).
    mkdirSync(join(root, 'assets/poses/col/vilao/src'), { recursive: true });
    writeFileSync(join(root, 'assets/skins/vilao.json'), JSON.stringify({ default: 'fly', dir: 'poses/col/vilao', poses: [{ name: 'fly', description: 'voando', tags: [] }] }));
  });

  it('pose do manifesto ainda sem imagem não pede --replace; --skeleton copia o esqueleto de outro personagem', async () => {
    const src = join(root, 'assets/poses/col/vilao/src/fly.png');
    await png(src);
    await runPoseAdd(['--char', 'vilao', '--pose', 'fly', '--src', src, '--skeleton', 'hero'], root);
    const skin = JSON.parse(readFileSync(join(root, 'assets/poses/col/vilao/fly.skin.json'), 'utf8'));
    expect(skin.char).toBe('vilao');
    expect(skin.bones.map((b: { name: string }) => b.name)).toEqual(['hips']);
    // Mesma figura, mesmo tamanho de imagem: a cabeça no mundo fica igual à do outro personagem.
    expect(skin.scale).toBe(2);
    expect(log.join('\n')).toMatch(/esqueleto inicial copiado de poses\/col\/hero\/fly/);
  });

  it('sem --skeleton, a primeira pose parte do esqueleto-modelo do CLI (16 ossos do corpo)', async () => {
    const src = join(root, 'assets/poses/col/vilao/src/fly.png');
    await png(src);
    await runPoseAdd(['--char', 'vilao', '--pose', 'fly', '--src', src], root);
    const skin = JSON.parse(readFileSync(join(root, 'assets/poses/col/vilao/fly.skin.json'), 'utf8'));
    expect(skin.bones).toHaveLength(16);
    expect(skin.chains).toEqual([]);
    expect(skin.measure).toBeDefined();
    expect(log.join('\n')).toMatch(/esqueleto-modelo "humanoide"/);
  });
});

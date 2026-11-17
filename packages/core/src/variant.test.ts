import { describe, expect, it } from 'vitest';
import { Actor } from './actor.js';
import type { AtlasImage } from './character.js';
import { Director } from './director.js';
import { buildVariant, silhouetteDiff } from './image-pose.js';
import { fighterCharacter } from './testing.js';

const W = 200, H = 80;
/** Imagem W×H com a figura cheia, menos `holes` colunas apagadas à direita (silhueta menor). */
function rgba(holes = 0, dx = 0): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = x - dx;
      px[(y * W + x) * 4 + 3] = sx >= 0 && sx < W - holes ? 255 : 0;
    }
  return px;
}
const img = (w = W, h = H) => ({ width: w, height: h }) as AtlasImage;

/** Personagem de teste com variantes declaradas e um carregador que devolve as imagens dadas. */
function withVariants(images: Record<string, Uint8ClampedArray>) {
  const ch = fighterCharacter();
  ch.poseIndex!.variants = {
    fly: [
      { name: 'angry', kind: 'expression', description: '', tags: [] },
      { name: 'nogun', kind: 'hand', description: '', tags: [] },
    ],
    punch: [{ name: 'angry', kind: 'expression', description: '', tags: [] }],
  };
  ch.loadVariantImage = async (pose, variant) => ({ image: img(), rgba: images[`${pose}@${variant}`]! });
  const warnings: string[] = [];
  ch.onWarning = (m) => warnings.push(m);
  return { ch, warnings };
}

describe('variantes de textura', () => {
  it('silhouetteDiff: fração de pixels diferentes e deslocamento do centro', () => {
    const a = new Uint8ClampedArray(100).fill(255);
    const b = new Uint8ClampedArray(100).fill(255);
    b.fill(0, 0, 10); // 1ª linha (10 px) a menos
    const r = silhouetteDiff(a, b, 10);
    expect(r.diff).toBeCloseTo(0.1, 6);
    expect(r.shift.y).toBeCloseTo(0.5, 6);
  });

  it('buildVariant reusa malha, esqueleto e rig; tamanho diferente é erro claro', async () => {
    const ch = fighterCharacter();
    const base = ch.imagePoses.get('fly')!;
    const v = buildVariant(base, 'angry', img(), rgba());
    expect(v.pose.mesh).toBe(base.mesh);
    expect(v.pose.rig).toBe(base.rig);
    expect(v.pose.restInverse).toBe(base.restInverse);
    expect(v.pose.name).toBe('fly');
    expect(v.pose.variant).toBe('angry');
    expect(v.diff).toBe(0);
    expect(() => buildVariant(base, 'angry', img(210, 80), new Uint8ClampedArray(210 * 80 * 4))).toThrow(/variante fly@angry: tamanho 210×80 diferente da base 200×80/);
    expect(() => buildVariant(ch.imagePoses.get('dodge')!, 'x', img(), rgba())).toThrow(/"dodge" é provisória/);
  });

  it('Character.loadVariant: avisa quando a silhueta muda mais de 3 %', async () => {
    const { ch, warnings } = withVariants({ 'fly@angry': rgba(2), 'fly@nogun': rgba(0, 12) });
    await ch.loadVariant('fly', 'angry'); // 2 colunas de 200 = 1 %
    expect(warnings).toEqual([]);
    await ch.loadVariant('fly', 'nogun'); // deslocada 12 px = 6 % (sobra 12 de 200 colunas)
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/fly@nogun: silhueta 6\.0 % diferente da base \(centro deslocado 6\.0, 0\.0 px\)/);
    await expect(ch.loadVariant('fly', 'laugh')).rejects.toThrow(/não tem a variante "laugh"/);
  });

  it('Actor.setVariant: troca só a textura; vale nas poses que têm a variante e volta com "none"', async () => {
    const { ch } = withVariants({ 'fly@angry': rgba(), 'fly@nogun': rgba(), 'punch@angry': rgba() });
    for (const [p, v] of [['fly', 'angry'], ['fly', 'nogun'], ['punch', 'angry']] as const) await ch.loadVariant(p, v);
    const a = new Actor(ch, { hover: false });
    expect(a.setVariant('expression', 'angry')).toBe(true);
    expect(a.variantPose?.variant).toBe('angry');
    expect(a.variantPose?.rig).toBe(ch.imagePoses.get('fly')!.rig);
    expect(a.setVariant('hand', 'nogun')).toBe(true); // a última escolhida vale
    expect(a.variantPose?.variant).toBe('nogun');
    a.setPose('punch', { transition: 'cut' });
    expect(a.variantPose?.variant).toBe('angry'); // punch não tem nogun
    a.setPose('hurt', { transition: 'cut' });
    expect(a.variantPose).toBeNull();
    expect(a.setVariant('expression', 'angry')).toBe(false); // hurt não tem: fica a imagem da pose
    a.setPose('fly', { transition: 'cut' });
    a.setVariant('hand', null);
    a.setVariant('expression', null);
    expect(a.variantPose).toBeNull();
  });

  it('roteiro: expression/hand escolhem a variante; sem ela, mantém a pose e avisa', async () => {
    const { ch } = withVariants({ 'fly@angry': rgba(), 'fly@nogun': rgba(), 'punch@angry': rgba() });
    const warnings: string[] = [];
    const d = await Director.create(
      {
        cast: { a: { at: [0, 0] } },
        steps: [
          { at: 0.1, actor: 'a', do: 'expression', params: { name: 'angry' } },
          { at: 0.2, actor: 'a', do: 'pose', params: { name: 'hurt', transition: 'cut' } },
          { at: 0.3, actor: 'a', do: 'hand', params: { name: 'nogun' } },
          { at: 0.4, actor: 'a', do: 'expression', params: { name: 'laugh' } },
        ],
      },
      { characters: { a: { character: ch } }, onWarning: (m) => warnings.push(m) },
    );
    // A medição da duração (simulação seca) já acusa o passo que cai numa pose sem a variante.
    expect(warnings).toEqual([
      'roteiro: "a" não tem a variante "laugh" (expression) em nenhuma pose: o passo não muda a imagem',
      'roteiro: "a" na pose "hurt" não tem a variante "nogun" (hand): mantém a imagem da pose',
    ]);
    d.seek(0.15);
    expect(d.world.fighter('a').actor.variantPose?.variant).toBe('angry');
    d.seek(0.35);
    const a = d.world.fighter('a').actor;
    expect(a.poseName).toBe('hurt');
    expect(a.variantPose).toBeNull();
    expect(d.warnings).toContain('"a" na pose "hurt" não tem a variante "nogun" (hand): mantém a imagem da pose');
  });
});

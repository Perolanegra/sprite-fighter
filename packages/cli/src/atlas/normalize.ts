/** Referência de escala de uma pose: topo do cabelo e queixo (px da imagem 1x). */
export interface MeasuredSkin {
  scale?: number;
  measure?: { headTop: number[]; chin: number[] };
}

/** Altura da cabeça (topo do cabelo → queixo) medida no skin.json, em px da imagem 1x. NaN sem `measure`. */
export const headHeight = (skin: MeasuredSkin) =>
  skin.measure ? Math.hypot(skin.measure.headTop[0]! - skin.measure.chin[0]!, skin.measure.headTop[1]! - skin.measure.chin[1]!) : NaN;

/**
 * `scale` (px do mundo por px da imagem) que deixa a cabeça desta pose do mesmo tamanho, no mundo,
 * que a da pose base: scale_base × cabeça_base / cabeça_pose, arredondado em 3 casas.
 */
export function normalizedScale(base: MeasuredSkin, pose: MeasuredSkin): number {
  const worldHead = headHeight(base) * (base.scale ?? 1);
  const h = headHeight(pose);
  if (!Number.isFinite(worldHead)) throw new Error('pose base sem measure.headTop/chin');
  if (!Number.isFinite(h) || h <= 0) throw new Error('pose sem measure.headTop/chin');
  return Math.round((worldHead / h) * 1000) / 1000;
}

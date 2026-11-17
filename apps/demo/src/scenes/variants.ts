import { CanvasRenderer, Skeleton, VARIANT_SILHOUETTE_WARN, silhouetteDiff, type ImagePose } from '@perolanegra/sprite-fighter';
import { loadCharacter, type CharName } from '../assets';

/**
 * ?scene=variants&char=<id> — conferência das variantes de textura: para cada variante, a pose base,
 * a variante desenhada com a malha e o esqueleto da base, e as silhuetas sobrepostas (vermelho = só
 * na base, ciano = só na variante, branco = nas duas), com a diferença em % (aviso acima de 3 %).
 */
export async function variantsScene(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const id = (params.get('char') ?? 'smith') as CharName;
  const char = await loadCharacter(id);
  const rows: { base: ImagePose; variant: ImagePose; kind: string }[] = [];
  for (const [pose, list] of Object.entries(char.poseIndex?.variants ?? {}))
    for (const v of list) rows.push({ base: await char.loadPose(pose), variant: await char.loadVariant(pose, v.name), kind: v.kind });
  const r = new CanvasRenderer(canvas);
  r.useWebGL = params.get('gl') !== '0';
  r.resize(innerWidth, innerHeight);
  r.background = '#1b2333';
  r.camera = { x: 0, y: 0, zoom: 1 };
  r.clear();
  const { ctx } = r;
  const label = (text: string, x: number, y: number, color = 'rgba(255,255,255,0.85)') => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = color;
    ctx.font = `${13 * r.dpr}px system-ui, sans-serif`;
    ctx.fillText(text, x * r.dpr, y * r.dpr);
  };
  label(`${char.name} · ${rows.length} variante(s) · base | variante (malha da base) | silhuetas: vermelho = só base, ciano = só variante`, 12, 22);
  if (!rows.length) return;
  const cellW = (innerWidth - 40) / 3, cellH = (innerHeight - 50) / rows.length;
  rows.forEach(({ base, variant, kind }, i) => {
    const top = 40 + i * cellH;
    const k = Math.min((cellW - 20) / base.width, (cellH - 40) / base.height);
    // Base e variante: o mesmo esqueleto em repouso, só a textura muda.
    [undefined, variant].forEach((v, c) => {
      const s = new Skeleton(base.rig);
      const left = 10 + c * (cellW + 10);
      // Mundo = px CSS; a pose em repouso vai com a raiz na origem, escalada para caber.
      r.camera = { x: 0, y: 0, zoom: k / base.spec.scale };
      const z = r.camera.zoom;
      r.camera.x = (innerWidth / 2 - (left + base.origin.x * k)) / z;
      r.camera.y = (innerHeight / 2 - (top + 24 + base.origin.y * k)) / z;
      s.update();
      r.drawPrepared(r.prepare(s, char, undefined, false, v));
    });
    // Silhuetas sobrepostas.
    const { diff, shift } = silhouetteDiff(base.alpha, variant.alpha, base.width);
    const img = new ImageData(base.width, base.height);
    for (let p = 0; p < base.alpha.length; p++) {
      const a = base.alpha[p]! >= 128, b = variant.alpha[p]! >= 128;
      if (!a && !b) continue;
      const rgb = a && b ? [230, 232, 240] : a ? [255, 70, 70] : [60, 220, 255];
      img.data.set([...rgb, a && b ? 120 : 255], p * 4);
    }
    const tmp = new OffscreenCanvas(base.width, base.height);
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tmp, (10 + 2 * (cellW + 10)) * r.dpr, (top + 24) * r.dpr, base.width * k * r.dpr, base.height * k * r.dpr);
    const warn = diff > VARIANT_SILHOUETTE_WARN;
    label(`${base.name}`, 10, top + 14);
    label(`${base.name}@${variant.variant} (${kind})`, 10 + cellW + 10, top + 14);
    label(`silhueta ${(diff * 100).toFixed(1)} % · centro ${shift.x.toFixed(1)}, ${shift.y.toFixed(1)} px${warn ? ' · AVISO > 3 %' : ' · ok'}`, 10 + 2 * (cellW + 10), top + 14, warn ? '#ffb347' : '#7be0a0');
  });
}

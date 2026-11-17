import { CanvasRenderer } from 'sprite-fighter';
import { listCharacters, loadCharacter } from '../assets';
import { drawBones } from '../debug';

/**
 * ?scene=rig: os personagens com rig de peças, montados na pose de voo; com dois, o segundo fica virado
 * (flip). `&flip=1` inverte os dois; `&debug=1` mostra os ossos.
 */
export async function rigScene(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const renderer = new CanvasRenderer(canvas);
  renderer.resize(innerWidth, innerHeight);
  renderer.camera = { x: 0, y: 0, zoom: Number(params.get('zoom') ?? 0.55) };
  const flip = params.get('flip') === '1';
  const only = params.get('char');
  const ids = (await listCharacters()).filter((c) => c.parts && (!only || c.id === only)).map((c) => c.id);
  if (only && !ids.length) throw new Error(`${only} não tem rig de peças (atlas + rig); veja as poses em ?scene=skin&char=${only}&mode=strip`);
  const chars = await Promise.all(ids.map(loadCharacter));
  renderer.clear();
  chars.forEach((char, i) => {
    const s = char.createSkeleton();
    s.root.x = chars.length === 1 ? 0 : i === 0 ? -520 : 520;
    s.root.y = 0;
    // Com os dois, o smith (segundo) fica de frente pro neo; sozinho, cada um olha pra direita.
    s.root.flip = (chars.length > 1 && i === 1) !== flip;
    s.update();
    renderer.drawSkeleton(s, char);
    if (params.get('debug') === '1') drawBones(renderer, s, { names: params.get('names') === '1' });
  });
}

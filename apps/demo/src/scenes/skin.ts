import { Actor, CanvasRenderer, SIM_DT, Skeleton, type ClipData } from '@perolanegra/sprite-fighter';
import { drawSkinDebug } from '@perolanegra/sprite-fighter/authoring';
import { loadCharacter, type CharName } from '../assets';
import { loadClips } from '../clips';
import { drawBones } from '../debug';

/**
 * ?scene=skin&char=neo&pose=fly&mode=rest|anim|debug|strip — poses-imagem.
 *  - rest: 1:1 com a imagem (px da 1x), sem flutuação/molas/squash, fundo branco (comparação de pixels);
 *  - anim: o idle_fly (`&t=` congela num instante); debug: malha, ossos e calor (`&heat=osso`);
 *  - strip: todas as poses do personagem lado a lado na MESMA escala do mundo (consistência).
 * `&gl=0` força o fallback Canvas 2D.
 */
export async function skinScene(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const char = await loadCharacter((params.get('char') as CharName) ?? 'neo');
  const mode = params.get('mode') ?? 'anim';
  const renderer = new CanvasRenderer(canvas);
  renderer.useWebGL = params.get('gl') !== '0';
  if (mode === 'strip') return strip(renderer, char, params);

  const poseName = params.get('pose') ?? char.poseIndex?.default ?? 'fly';
  const pose = await char.loadPose(poseName);
  char.setPose(poseName, { transition: 'cut' });
  // Em px da imagem 1x: desfaz a escala da pose e a âncora (o quadril cai na origem).
  const actor = new Actor(char, { hover: mode !== 'rest', cloth: mode !== 'rest', squash: mode !== 'rest', scale: 1 / pose.spec.scale });
  actor.position = { x: -pose.anchor.x / pose.spec.scale, y: -pose.anchor.y / pose.spec.scale };
  const center = { x: pose.width / 2 - pose.origin.x, y: pose.height / 2 - pose.origin.y };

  if (mode === 'rest') {
    renderer.resize(pose.width, pose.height, 1);
    renderer.background = '#ffffff';
    renderer.camera = { ...center, zoom: 1 };
    actor.step(SIM_DT);
    renderer.clear();
    actor.draw(renderer, 1);
    return;
  }

  const clips = await loadClips();
  renderer.resize(innerWidth, innerHeight);
  renderer.background = '#1b2333';
  const fit = Math.min(innerWidth / pose.width, (innerHeight - 40) / pose.height) * 0.92;
  renderer.camera = { ...center, zoom: Number(params.get('zoom') ?? fit) };
  actor.play(clips.get(params.get('clip') ?? 'idle_fly') as ClipData);
  const t = Number(params.get('t') ?? 0);
  for (let i = 0, n = Math.round(t / SIM_DT); i <= n; i++) actor.step(SIM_DT);
  renderer.clear();
  actor.draw(renderer, 1);
  if (mode === 'debug') {
    const heat = params.get('heat');
    drawSkinDebug(renderer, actor.view, char, { heatBone: heat ? actor.view.bone(heat) : undefined });
    drawBones(renderer, actor.view, { names: params.get('names') === '1' });
  }
  label(renderer, `${char.name} · pose ${poseName} · ${renderer.webGL ? 'WebGL' : 'Canvas 2D'} · ${pose.mesh.vertexCount} vértices, ${pose.mesh.triangles.length / 3} triângulos · escala ${pose.spec.scale}`);
}

/** Todas as poses lado a lado, na escala do mundo (a mesma cabeça em todas), quadris alinhados. */
async function strip(renderer: CanvasRenderer, char: Awaited<ReturnType<typeof loadCharacter>>, params: URLSearchParams): Promise<void> {
  const names = char.poseIndex?.poses ?? [];
  const poses = await Promise.all(names.map((n) => char.loadPose(n)));
  renderer.resize(innerWidth, innerHeight);
  renderer.background = params.get('bg') ?? '#1b2333';
  // Caixa de cada pose no mundo (raiz na origem).
  const boxes = poses.map((p) => {
    const k = p.spec.scale;
    return { x0: -p.origin.x * k, x1: (p.width - p.origin.x) * k, y0: -p.origin.y * k, y1: (p.height - p.origin.y) * k };
  });
  const gap = 60;
  const total = boxes.reduce((s, b) => s + (b.x1 - b.x0), 0) + gap * (boxes.length - 1);
  const y0 = Math.min(...boxes.map((b) => b.y0)), y1 = Math.max(...boxes.map((b) => b.y1));
  const zoom = Math.min(innerWidth / total, (innerHeight - 60) / (y1 - y0)) * 0.96;
  renderer.camera = { x: total / 2, y: (y0 + y1) / 2 - 10 / zoom, zoom };
  renderer.clear();
  let x = 0;
  const v = renderer.viewMatrix();
  poses.forEach((p, i) => {
    const b = boxes[i]!;
    const s = new Skeleton(p.rig);
    s.root.x = x - b.x0;
    s.update();
    renderer.drawSkeleton(s, char);
    // Linha da altura da cabeça medida (topo do cabelo → queixo), pra conferir a normalização.
    if (p.spec.measure) {
      const { ctx } = renderer;
      const k = p.spec.scale;
      const pt = (q: { x: number; y: number }) => ({ x: v[0] * (s.root.x + (q.x - p.origin.x) * k) + v[4], y: v[3] * ((q.y - p.origin.y) * k) + v[5] });
      const a = pt(p.spec.measure.headTop), c = pt(p.spec.measure.chin);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2 * renderer.dpr;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
    }
    const { ctx } = renderer;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `${13 * renderer.dpr}px system-ui, sans-serif`;
    ctx.fillText(`${p.name} (${p.spec.scale})`, v[0] * x + v[4], renderer.canvas.height - 14 * renderer.dpr);
    x += b.x1 - b.x0 + gap;
  });
  label(renderer, `${char.name} · ${poses.length} poses na mesma escala (linha amarela = altura da cabeça medida)`);
}

function label(r: CanvasRenderer, text: string): void {
  const { ctx } = r;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = `${13 * r.dpr}px system-ui, sans-serif`;
  ctx.fillText(text, 12 * r.dpr, 22 * r.dpr);
}

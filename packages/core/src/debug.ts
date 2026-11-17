import type { Character } from './character.js';
import type { Capsule } from './collision.js';
import { deformLBS, skinMatrices } from './deform.js';
import type { Vec2 } from './math.js';
import type { CanvasRenderer } from './renderer.js';
import type { Skeleton } from './skeleton.js';
import type { World } from './world.js';

/** Debug de pose-imagem: malha deformada (arame) e, se pedido, o peso de um osso em calor. */
export function drawSkinDebug(r: CanvasRenderer, skeleton: Skeleton, character: Character, options: { heatBone?: number; wire?: boolean } = {}): void {
  const pose = character.imagePoseOf(skeleton.rig);
  if (!pose) return;
  const mats = new Float32Array(pose.rig.bones.length * 6);
  skinMatrices(skeleton, pose.restInverse, mats);
  const d = deformLBS(pose.mesh, mats, pose.origin);
  const v = r.viewMatrix();
  const { ctx } = r;
  ctx.setTransform(v[0], v[1], v[2], v[3], v[4], v[5]);
  const T = pose.mesh.triangles, W = pose.mesh.weights, I = pose.mesh.boneIndices;
  const weightOf = (vi: number, b: number) => {
    let w = 0;
    for (let k = 0; k < 4; k++) if (I[vi * 4 + k] === b) w += W[vi * 4 + k]!;
    return w;
  };
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t]!, b = T[t + 1]!, c = T[t + 2]!;
    ctx.beginPath();
    ctx.moveTo(d[a * 2]!, d[a * 2 + 1]!);
    ctx.lineTo(d[b * 2]!, d[b * 2 + 1]!);
    ctx.lineTo(d[c * 2]!, d[c * 2 + 1]!);
    ctx.closePath();
    if (options.heatBone !== undefined) {
      const w = (weightOf(a, options.heatBone) + weightOf(b, options.heatBone) + weightOf(c, options.heatBone)) / 3;
      if (w > 0.01) {
        ctx.fillStyle = `rgba(255, ${Math.round(220 * (1 - w))}, 0, ${0.15 + 0.55 * w})`;
        ctx.fill();
      }
    }
    if (options.wire !== false) {
      ctx.strokeStyle = 'rgba(0, 200, 255, 0.55)';
      ctx.lineWidth = 0.8 / (v[0] || 1);
      ctx.stroke();
    }
  }
}


/**
 * Debug de luta (`?debug=1`): ossos, hurtboxes (azul), hitboxes ativas (vermelho), projéteis,
 * props e, por personagem, a pose atual (`image:shoot`, com PROVISÓRIA em laranja), o golpe,
 * a fase e o frame. `mesh` desenha também a malha das poses-imagem.
 */
export function drawFightDebug(r: CanvasRenderer, world: World, opts: { mesh?: boolean; bones?: boolean } = {}): void {
  const { ctx } = r;
  const v = r.viewMatrix();
  const k = v[0];
  const S = (p: Vec2) => ({ x: p.x * v[0] + v[4], y: p.y * v[3] + v[5] });
  const capsule = (c: Capsule, fill: string, stroke: string) => {
    const a = S(c.a), b = S(c.b);
    ctx.lineCap = 'round';
    ctx.strokeStyle = fill;
    ctx.lineWidth = Math.max(2, 2 * c.r * k);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x + 0.01, b.y);
    ctx.stroke();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5 * r.dpr;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x + 0.01, b.y);
    ctx.stroke();
  };

  for (const f of world.fighters.values()) if (opts.mesh) drawSkinDebug(r, f.actor.view, f.actor.character, { wire: true });
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const prop of world.props.values()) {
    const a = S({ x: prop.box.x, y: prop.box.y }), b = S({ x: prop.box.x + prop.box.w, y: prop.box.y + prop.box.h });
    ctx.strokeStyle = prop.solid ? 'rgba(255,170,60,0.9)' : 'rgba(255,170,60,0.35)';
    ctx.lineWidth = 2 * r.dpr;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  }
  for (const f of world.fighters.values()) {
    if (f.actor.opacity <= 0) continue;
    const s = f.actor.sim;
    if (opts.bones !== false) {
      ctx.strokeStyle = 'rgba(94,224,255,0.7)';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1.5 * r.dpr;
      s.rig.bones.forEach((_, i) => {
        const p = S(s.pivotWorld(i)), q = S(s.endWorld(i));
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5 * r.dpr, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    for (const h of f.hurtboxes) capsule(h, 'rgba(70,130,255,0.22)', 'rgba(110,160,255,0.9)');
    for (const h of f.hitboxes) capsule(h, 'rgba(255,40,40,0.4)', 'rgba(255,80,80,1)');

    // Etiqueta acima da cabeça.
    const head = s.rig.byName.get('head');
    const top = S(head !== undefined ? s.endWorld(head) : f.actor.position);
    const pose = f.actor.imagePose;
    const lines: { text: string; color: string }[] = [{ text: `${f.id} · ${f.actor.skinKey}${f.actor.variantPose ? `@${f.actor.variantPose.variant}` : ''}`, color: '#ffffff' }];
    if (pose?.provisional) lines.push({ text: `PROVISÓRIA ← ${pose.provisional.from}`, color: '#ff9b2f' });
    if (f.runner) lines.push({ text: `${f.runner.move.id} · ${f.runner.phase.name} · f${Math.floor(f.runner.frame)}/${f.runner.phase.frames}`, color: '#ffd23f' });
    if (f.stun > 0) lines.push({ text: `reação ${Math.ceil(f.stun)}f`, color: '#ff8080' });
    ctx.font = `bold ${12 * r.dpr}px ui-monospace, monospace`;
    lines.forEach((l, i) => {
      const y = top.y - (lines.length - i) * 16 * r.dpr - 8 * r.dpr;
      const w = ctx.measureText(l.text).width;
      ctx.fillStyle = 'rgba(10,12,20,0.75)';
      ctx.fillRect(top.x - w / 2 - 4 * r.dpr, y - 12 * r.dpr, w + 8 * r.dpr, 16 * r.dpr);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, top.x - w / 2, y);
    });
  }
  for (const p of world.projectiles) capsule({ a: p.position, b: p.position, r: p.radius }, 'rgba(255,40,40,0.4)', 'rgba(255,80,80,1)');
  ctx.restore();
}

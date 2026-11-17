import { assembleImagePose, CanvasRenderer, Skeleton, type Character, type ImagePose, type SkinSpec, type Vec2 } from 'sprite-fighter';
import { drawSkinDebug } from 'sprite-fighter/authoring';
import { listCharacters, loadCharacter, type CharName } from '../assets';

/**
 * Pose Lab, modo "Pose-imagem" (?scene=poselab&mode=image&char=neo&pose=fly):
 * a imagem da pose com o esqueleto por cima. Arraste uma articulação (bolinha) pra mover;
 * ao soltar, malha e pesos são refeitos. Clique num osso pra ver o peso dele em calor.
 * "Salvar esqueleto" grava assets/<pose>/<char>.skin.json (só no npm run dev).
 * Escala da pose: a pose base aparece como fantasma ao lado, na escala relativa; as linhas amarelas
 * (topo do cabelo → queixo) precisam ficar do mesmo tamanho. Os dois quadrados amarelos são a medida
 * da cabeça: arrastar um deles corrige a medida e a escala junto (a cabeça no mundo não muda de
 * tamanho). O slider muda só a escala. "Salvar esqueleto" grava `scale` e `measure` no skin.json.
 */
export async function skinLabScene(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const app = canvas.parentElement!;
  app.style.display = 'grid';
  app.style.gridTemplateColumns = '1fr 320px';
  const panel = document.createElement('aside');
  panel.className = 'lab';
  app.append(panel);

  const renderer = new CanvasRenderer(canvas);
  renderer.background = '#2a2d3a';
  const charIds = (await listCharacters()).map((c) => c.id);
  let char!: Character;
  let pose!: ImagePose;
  let rgba!: Uint8ClampedArray;
  let skel!: Skeleton;
  /** Fantasma da pose base (fly), na mesma escala do mundo; null quando a própria fly está aberta. */
  let ghost: { pose: ImagePose; skel: Skeleton } | null = null;
  let showGhost = params.get('ghost') !== '0';
  let selected = -1;
  let showMesh = params.get('mesh') !== '0';
  let status = '';
  let dirty = false;

  const size = () => renderer.resize(app.clientWidth - 320, app.clientHeight);
  addEventListener('resize', () => {
    size();
    draw();
  });
  size();

  async function setCharacter(name: CharName, poseName?: string): Promise<void> {
    char = await loadCharacter(name);
    const target = poseName ?? char.pose ?? char.poseIndex?.default ?? 'fly';
    pose = await char.loadPose(target);
    const c = new OffscreenCanvas(pose.width, pose.height);
    const cx = c.getContext('2d', { willReadFrequently: true })!;
    cx.drawImage(pose.image, 0, 0);
    rgba = cx.getImageData(0, 0, pose.width, pose.height).data;
    skel = new Skeleton(pose.rig);
    skel.root.scale = 1 / pose.spec.scale; // edição em px da imagem
    skel.update();
    const base = char.poseIndex?.default;
    ghost = base && base !== pose.name ? { pose: await char.loadPose(base), skel: null! } : null;
    if (ghost) ghost.skel = new Skeleton(ghost.pose.rig);
    placeGhost();
    selected = -1;
    dirty = false;
    // Com fantasma, a vista centraliza o par (fantasma à esquerda + pose).
    const left = ghost ? ghost.skel.root.x - ghost.pose.origin.x * (ghost.pose.spec.scale / pose.spec.scale) : -pose.origin.x;
    // Zoom inicial: o par inteiro cabe na vista (no máximo 1:1).
    const right = pose.width - pose.origin.x;
    const fit = Math.min(1, (renderer.width - 40) / (right - left), (renderer.height - 40) / pose.height);
    renderer.camera = { x: (left + right) / 2, y: pose.height / 2 - pose.origin.y, zoom: Number(params.get('zoom') ?? fit) };
    status = `${pose.mesh.vertexCount} vértices · ${pose.mesh.triangles.length / 3} triângulos`;
    renderPanel();
    draw();
  }

  /** Fantasma à esquerda, quadris na mesma altura, na escala relativa (fly.scale / pose.scale). */
  function placeGhost(): void {
    if (!ghost) return;
    const k = ghost.pose.spec.scale / pose.spec.scale;
    ghost.skel.root.scale = 1 / pose.spec.scale;
    ghost.skel.root.x = -pose.origin.x - (ghost.pose.width - ghost.pose.origin.x) * k - 40;
    ghost.skel.update();
  }

  /** Muda a escala da pose (px do mundo por px da imagem): só o tamanho relativo ao fantasma muda na tela. */
  function setScale(value: number): void {
    if (!(value > 0)) return;
    pose.spec.scale = Math.round(value * 1000) / 1000;
    pose.rig.bones[pose.rig.roots[0]!]!.scale = pose.spec.scale;
    skel.root.scale = 1 / pose.spec.scale;
    skel.update();
    placeGhost();
    dirty = true;
    draw();
  }

  /** Linha topo do cabelo → queixo (altura da cabeça medida), em px de tela. */
  function measureLine(p: ImagePose, at: (q: Vec2) => Vec2): void {
    if (!p.spec.measure) return;
    const { ctx } = renderer;
    const a = at(p.spec.measure.headTop), c = at(p.spec.measure.chin);
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 3 * renderer.dpr;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
  }

  /** Articulação no mundo (raiz da pose na origem). */
  const toWorld = (p: Vec2): Vec2 => ({ x: p.x - pose.origin.x, y: p.y - pose.origin.y });

  function draw(): void {
    renderer.clear();
    if (ghost && showGhost) renderer.drawSkeleton(ghost.skel, char, { alpha: 0.55 });
    renderer.drawSkeleton(skel, char);
    drawSkinDebug(renderer, skel, char, { heatBone: selected >= 0 ? selected : undefined, wire: showMesh });
    // Ossos da pose: linha cabeça→cauda e as duas articulações (arrastáveis).
    const { ctx } = renderer;
    const v = renderer.viewMatrix();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const scr = (p: Vec2) => {
      const w = toWorld(p);
      return { x: v[0] * w.x + v[4], y: v[3] * w.y + v[5] };
    };
    measureLine(pose, scr);
    if (pose.spec.measure)
      for (const q of [pose.spec.measure.headTop, pose.spec.measure.chin]) {
        const m = scr(q);
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(m.x - 6 * renderer.dpr, m.y - 6 * renderer.dpr, 12 * renderer.dpr, 12 * renderer.dpr);
      }
    if (ghost && showGhost) {
      const g = ghost;
      const k = g.pose.spec.scale / pose.spec.scale;
      measureLine(g.pose, (q) => ({ x: v[0] * (g.skel.root.x + (q.x - g.pose.origin.x) * k) + v[4], y: v[3] * ((q.y - g.pose.origin.y) * k) + v[5] }));
    }
    const cloth = new Set(pose.spec.chains.flatMap((c) => c.bones));
    pose.spec.bones.forEach((b, i) => {
      const h = scr(b.head), t = scr(b.tail);
      const color = i === selected ? '#ffd23f' : cloth.has(b.name) ? '#ff9a3c' : b.name.includes('back') ? '#a37bff' : '#3cc8ff';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = (i === selected ? 4 : 2.5) * renderer.dpr;
      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
      for (const p of [h, t]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5 * renderer.dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      if (i === selected) {
        ctx.font = `${12 * renderer.dpr}px system-ui, sans-serif`;
        ctx.fillText(b.name, h.x + 8, h.y - 8);
      }
    });
  }

  // --- Arrastar articulações ------------------------------------------------
  /** Os pontos que coincidem (cauda da mãe = cabeça da filha) andam juntos. */
  function jointsAt(img: Vec2, radius: number): { bone: number; end: 'head' | 'tail' }[] {
    const out: { bone: number; end: 'head' | 'tail' }[] = [];
    pose.spec.bones.forEach((b, i) => {
      if (Math.hypot(b.head.x - img.x, b.head.y - img.y) <= radius) out.push({ bone: i, end: 'head' });
      if (Math.hypot(b.tail.x - img.x, b.tail.y - img.y) <= radius) out.push({ bone: i, end: 'tail' });
    });
    return out;
  }

  const toImage = (sx: number, sy: number): Vec2 => {
    const w = renderer.screenToWorld(sx, sy);
    return { x: w.x + pose.origin.x, y: w.y + pose.origin.y };
  };

  let drag:
    | { joints: { bone: number; end: 'head' | 'tail' }[]; start: Vec2; orig: Vec2[] }
    | { pan: true; sx: number; sy: number; cx: number; cy: number }
    | { measure: 'headTop' | 'chin'; start: Vec2; orig: Vec2; worldHead: number }
    | null = null;

  const headPx = () => (pose.spec.measure ? Math.hypot(pose.spec.measure.headTop.x - pose.spec.measure.chin.x, pose.spec.measure.headTop.y - pose.spec.measure.chin.y) : NaN);

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.shiftKey) {
      drag = { pan: true, sx: e.offsetX, sy: e.offsetY, cx: renderer.camera.x, cy: renderer.camera.y };
      return;
    }
    const img = toImage(e.offsetX, e.offsetY);
    const radius = 9 / renderer.camera.zoom;
    // Medida da cabeça (quadrados amarelos): tem prioridade sobre as articulações.
    const m = pose.spec.measure;
    const end = m && (['headTop', 'chin'] as const).find((k) => Math.hypot(m[k].x - img.x, m[k].y - img.y) <= radius);
    if (m && end) {
      drag = { measure: end, start: img, orig: { ...m[end] }, worldHead: headPx() * pose.spec.scale };
      return;
    }
    // A articulação mais próxima (e todas as coincidentes com ela).
    let best: { bone: number; end: 'head' | 'tail'; d: number } | null = null;
    pose.spec.bones.forEach((b, i) => {
      for (const end of ['head', 'tail'] as const) {
        const d = Math.hypot(b[end].x - img.x, b[end].y - img.y);
        if (d <= radius && (!best || d < best.d)) best = { bone: i, end, d };
      }
    });
    if (best) {
      const p = pose.spec.bones[(best as { bone: number }).bone]![(best as { end: 'head' | 'tail' }).end];
      const joints = jointsAt(p, 0.5);
      selected = (best as { bone: number }).bone;
      drag = { joints, start: img, orig: joints.map((j) => ({ ...pose.spec.bones[j.bone]![j.end] })) };
    } else {
      // Clique fora das articulações: seleciona o osso mais perto do segmento.
      let bi = -1, bd = Infinity;
      pose.spec.bones.forEach((b, i) => {
        const dx = b.tail.x - b.head.x, dy = b.tail.y - b.head.y;
        const t = Math.max(0, Math.min(1, ((img.x - b.head.x) * dx + (img.y - b.head.y) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(img.x - (b.head.x + t * dx), img.y - (b.head.y + t * dy));
        if (d < bd) (bd = d), (bi = i);
      });
      selected = bd < 20 / renderer.camera.zoom ? bi : -1;
    }
    renderPanel();
    draw();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if ('pan' in drag) {
      renderer.camera.x = drag.cx - (e.offsetX - drag.sx) / renderer.camera.zoom;
      renderer.camera.y = drag.cy - (e.offsetY - drag.sy) / renderer.camera.zoom;
      return draw();
    }
    const img = toImage(e.offsetX, e.offsetY);
    const dx = img.x - drag.start.x, dy = img.y - drag.start.y;
    if ('measure' in drag) {
      pose.spec.measure![drag.measure] = { x: Math.round((drag.orig.x + dx) * 10) / 10, y: Math.round((drag.orig.y + dy) * 10) / 10 };
      // A cabeça no mundo fica do mesmo tamanho: a escala acompanha a medida.
      return setScale(drag.worldHead / headPx());
    }
    drag.joints.forEach((j, k) => {
      const o = drag && 'joints' in drag ? drag.orig[k]! : { x: 0, y: 0 };
      pose.spec.bones[j.bone]![j.end] = { x: Math.round((o.x + dx) * 10) / 10, y: Math.round((o.y + dy) * 10) / 10 };
    });
    draw();
  });

  canvas.addEventListener('pointerup', () => {
    if (drag && 'measure' in drag) renderPanel();
    else if (drag && !('pan' in drag)) rebuild();
    drag = null;
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      renderer.camera.zoom = Math.min(6, Math.max(0.2, renderer.camera.zoom * Math.exp(-e.deltaY * 0.001)));
      draw();
    },
    { passive: false },
  );

  /** Refaz malha e pesos com as articulações novas (mesma pose, mesmos ossos). */
  function rebuild(): void {
    const t0 = performance.now();
    const next = assembleImagePose(pose.spec as SkinSpec, pose.image, rgba);
    char.imagePoses.set(next.name, next);
    pose = next;
    skel = new Skeleton(pose.rig);
    skel.root.scale = 1 / pose.spec.scale;
    skel.update();
    dirty = true;
    status = `malha refeita: ${pose.mesh.vertexCount} vértices · ${pose.mesh.triangles.length / 3} triângulos (${Math.round(performance.now() - t0)} ms)`;
    renderPanel();
    draw();
  }

  async function save(): Promise<void> {
    const s = pose.spec;
    const content = {
      version: 1,
      char: s.char,
      pose: s.pose,
      image: s.image,
      ...(s.image2x ? { image2x: s.image2x } : {}),
      scale: s.scale,
      ...(s.measure ? { measure: { headTop: [s.measure.headTop.x, s.measure.headTop.y], chin: [s.measure.chin.x, s.measure.chin.y] } } : {}),
      bones: s.bones.map((b) => ({ name: b.name, parent: b.parent, head: [b.head.x, b.head.y], tail: [b.tail.x, b.tail.y], limit: b.limit, ...(b.follow ? { follow: b.follow } : {}) })),
      chains: s.chains,
      mesh: { target: s.mesh.target, boundaryStep: s.mesh.boundaryStep, seed: s.mesh.seed, clothTolerance: s.mesh.clothTolerance },
    };
    const res = await fetch('/__sf/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `${char.poseIndex!.dir}/${s.pose}.skin.json`, content }),
    });
    const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    status = res.ok && out.ok ? `salvo em assets/${char.poseIndex!.dir}/${s.pose}.skin.json` : (out.error ?? `falha ao salvar (${res.status})`);
    if (res.ok && out.ok) dirty = false;
    renderPanel();
  }

  // --- Painel ---------------------------------------------------------------
  function renderPanel(): void {
    panel.innerHTML = '';
    const row = () => Object.assign(document.createElement('div'), { className: 'lab__row' });
    const button = (label: string, fn: () => void) => Object.assign(document.createElement('button'), { type: 'button', textContent: label, onclick: fn });
    const head = row();
    const charSel = document.createElement('select');
    for (const c of charIds) charSel.append(new Option(c, c, false, c === char.name));
    charSel.onchange = () => void setCharacter(charSel.value as CharName);
    const poseSel = document.createElement('select');
    for (const p of char.poseIndex?.poses ?? [pose.name]) poseSel.append(new Option(p, p, false, p === pose.name));
    poseSel.onchange = () => void setCharacter(char.name as CharName, poseSel.value);
    head.append(charSel, poseSel);
    if (char.hasParts) head.append(button('Modo peças', () => (location.search = `?scene=poselab&char=${char.name}`)));
    panel.append(head);

    const box = Object.assign(document.createElement('section'), { className: 'lab__box' });
    box.append(Object.assign(document.createElement('strong'), { textContent: `Pose-imagem "${pose.name}"` }));
    const hint = Object.assign(document.createElement('div'), {
      className: 'lab__hint',
      textContent:
        'Arraste as bolinhas (articulações). Ao soltar, malha e pesos são refeitos. Clique num osso pra ver o peso dele. Os quadrados amarelos são a medida da cabeça (topo do cabelo e queixo). Shift + arrastar move a vista; roda = zoom.',
    });
    const actions = row();
    actions.append(
      button(showMesh ? 'Ocultar malha' : 'Mostrar malha', () => {
        showMesh = !showMesh;
        renderPanel();
        draw();
      }),
      button(dirty ? 'Salvar esqueleto *' : 'Salvar esqueleto', () => void save()),
    );
    box.append(hint, actions, Object.assign(document.createElement('div'), { className: 'lab__hint', textContent: status }));
    panel.append(box);

    // Escala da pose, comparada com o fantasma da fly.
    const scaleBox = Object.assign(document.createElement('section'), { className: 'lab__box' });
    scaleBox.append(Object.assign(document.createElement('strong'), { textContent: 'Escala da pose' }));
    const scaleRow = row();
    const slider = Object.assign(document.createElement('input'), { type: 'range', min: '0.2', max: '2.5', step: '0.001', value: String(pose.spec.scale) });
    const num = Object.assign(document.createElement('input'), { type: 'number', min: '0.05', step: '0.001', value: String(pose.spec.scale) });
    num.style.width = '80px';
    slider.oninput = () => {
      num.value = slider.value;
      setScale(Number(slider.value));
    };
    num.onchange = () => {
      slider.value = num.value;
      setScale(Number(num.value));
      renderPanel();
    };
    scaleRow.append(slider, num);
    const ghostRow = row();
    if (ghost)
      ghostRow.append(
        button(showGhost ? `Ocultar fantasma (${ghost.pose.name})` : `Mostrar fantasma (${ghost.pose.name})`, () => {
          showGhost = !showGhost;
          renderPanel();
          draw();
        }),
      );
    scaleBox.append(
      scaleRow,
      ghostRow,
      Object.assign(document.createElement('div'), {
        className: 'lab__hint',
        textContent: ghost
          ? 'As linhas amarelas (topo do cabelo → queixo) precisam ter o mesmo tamanho nas duas figuras. "Salvar esqueleto" grava a escala.'
          : 'Esta é a pose base: as outras se ajustam a ela.',
      }),
    );
    panel.append(scaleBox);

    if (selected >= 0) {
      const b = pose.spec.bones[selected]!;
      const sel = Object.assign(document.createElement('section'), { className: 'lab__box' });
      sel.append(
        Object.assign(document.createElement('strong'), { textContent: b.name }),
        Object.assign(document.createElement('div'), {
          className: 'lab__hint',
          textContent: `cabeça (${b.head.x.toFixed(0)}, ${b.head.y.toFixed(0)}) → cauda (${b.tail.x.toFixed(0)}, ${b.tail.y.toFixed(0)}) · limite ±${b.limit}°${b.follow ? ` · segue ${b.follow}` : ''}`,
        }),
      );
      panel.append(sel);
    }

    const tree = Object.assign(document.createElement('ul'), { className: 'lab__tree' });
    const depth = (i: number): number => (pose.rig.bones[i]!.parent >= 0 ? 1 + depth(pose.rig.bones[i]!.parent) : 0);
    pose.spec.bones.forEach((b, i) => {
      const li = Object.assign(document.createElement('li'), { textContent: b.name, className: i === selected ? 'is-selected' : '' });
      li.style.paddingLeft = `${8 + depth(i) * 14}px`;
      li.onclick = () => {
        selected = i;
        renderPanel();
        draw();
      };
      tree.append(li);
    });
    panel.append(tree);
  }

  await setCharacter((params.get('char') as CharName) ?? 'neo', params.get('pose') ?? undefined);
  if (params.get('heat')) {
    selected = pose.rig.byName.get(params.get('heat')!) ?? -1;
    renderPanel();
    draw();
  }
}

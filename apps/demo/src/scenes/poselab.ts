import { apply, deg2rad, invert, multiply, rad2deg, scaling, translation, CanvasRenderer, type Character, type Mat2D, type Skeleton } from 'sprite-fighter';
import { listCharacters, loadCharacter, type CharName } from '../assets';
import { drawBones } from '../debug';
import { loadPose, savePose } from '../poses';

/**
 * ?scene=poselab&char=neo — ferramenta de autoria de poses.
 *
 * - Clique numa peça (ou no nome, na lista) pra selecionar o osso; arraste pra girar pela articulação.
 * - Roda do mouse = zoom; Shift + arrastar = mover a vista.
 * - Fantasma de referência: a folha do personagem (ou qualquer imagem) atrás do rig, com opacidade.
 *   Com "Mover fantasma" ligado, arrastar move a imagem e a roda escala (em volta do cursor).
 * - Poses nomeadas: carrega/salva assets/poses/<char>/<nome>.json (ex.: fly_rest, a base do idle_fly).
 */
interface Ghost {
  src: string;
  /** Ponto da imagem (px) que fica em (x, y) do mundo. */
  ax: number;
  ay: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  visible: boolean;
}

/** Ponto de partida: a figura voando da folha de referência perto da origem do rig. */
const DEFAULT_GHOST: Partial<Record<CharName, Omit<Ghost, 'visible' | 'opacity'>>> = {
  neo: { src: '/reference/neo-draft.png', ax: 1115, ay: 184, x: 0, y: 0, scale: 2.0 },
  smith: { src: '/reference/smith-draft.png', ax: 1124, ay: 292, x: 0, y: 0, scale: 1.47 },
};

const ghostKey = (c: string) => `sf-poselab-ghost-${c}`;
/** Fantasma padrão: a folha de referência do personagem, se houver. */
const defaultGhost = (c: string) => DEFAULT_GHOST[c] ?? { src: `/reference/${c}-draft.png`, ax: 0, ay: 0, x: 0, y: 0, scale: 1 };

export async function poseLabScene(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  if (params.get('mode') === 'image') {
    injectStyles();
    return (await import('./skinlab')).skinLabScene(canvas, params);
  }
  const app = canvas.parentElement!;
  app.style.display = 'grid';
  app.style.gridTemplateColumns = '1fr 320px';
  const panel = document.createElement('aside');
  panel.className = 'lab';
  app.append(panel);
  injectStyles();

  const renderer = new CanvasRenderer(canvas);
  // O modo peças só vale para quem tem atlas + rig; os outros usam o modo Pose-imagem.
  const partsIds = (await listCharacters()).filter((c) => c.parts).map((c) => c.id);
  const wanted = params.get('char') ?? partsIds[0] ?? '';
  if (!partsIds.includes(wanted)) throw new Error(`${wanted} não tem rig de peças (atlas + rig): use o modo Pose-imagem, ?scene=poselab&mode=image&char=${wanted}`);
  let char!: Character;
  let skel!: Skeleton;
  let alpha!: (part: string, x: number, y: number) => number;
  let selected = -1;
  let showBones = params.get('bones') !== '0';
  let rigOpacity = 1;
  let ghost: Ghost | null = null;
  let ghostImage: HTMLImageElement | null = null;
  let movingGhost = false;
  let poseName = params.get('pose') ?? 'fly_rest';
  let status = '';

  const size = () => renderer.resize(app.clientWidth - 320, app.clientHeight);
  addEventListener('resize', () => {
    size();
    draw();
  });
  size();

  // --- Fantasma -------------------------------------------------------------
  function saveGhost(): void {
    if (!ghost) return;
    try {
      // A imagem carregada do disco (blob:) não sobrevive ao recarregar: guarda só o alinhamento.
      localStorage.setItem(ghostKey(char.name), JSON.stringify({ ...ghost, src: ghost.src.startsWith('blob:') ? undefined : ghost.src }));
    } catch {
      /* sem armazenamento: segue sem lembrar */
    }
  }

  function restoreGhost(name: CharName): Ghost {
    const base: Ghost = { ...defaultGhost(name), opacity: 0.45, visible: true };
    try {
      const saved = JSON.parse(localStorage.getItem(ghostKey(name)) ?? 'null') as Partial<Ghost> | null;
      if (saved) return { ...base, ...saved, src: saved.src ?? base.src };
    } catch {
      /* ignora */
    }
    return base;
  }

  function loadGhostImage(src: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        ghostImage = img;
        resolve();
      };
      img.onerror = () => {
        ghostImage = null;
        status = `não foi possível carregar a imagem ${src}`;
        resolve();
      };
      img.src = src;
    });
  }

  const ghostMatrix = (g: Ghost): Mat2D => multiply(multiply(translation(g.x, g.y), scaling(g.scale)), translation(-g.ax, -g.ay));

  // --- Personagem e pose ----------------------------------------------------
  async function setCharacter(name: CharName): Promise<void> {
    char = await loadCharacter(name);
    skel = char.createSkeleton();
    selected = -1;
    const off = new OffscreenCanvas(char.image.width, char.image.height);
    const octx = off.getContext('2d', { willReadFrequently: true })!;
    octx.drawImage(char.image, 0, 0);
    const pixels = octx.getImageData(0, 0, off.width, off.height).data;
    alpha = (partName, x, y) => {
      const p = char.parts.get(partName)!;
      const px = Math.floor(x * char.atlas.scale), py = Math.floor(y * char.atlas.scale);
      if (px < 0 || py < 0 || px >= p.w || py >= p.h) return 0;
      return pixels[((p.y + py) * off.width + p.x + px) * 4 + 3]!;
    };
    renderer.camera = { x: 0, y: 0, zoom: Number(params.get('zoom') ?? 0.6) };
    ghost = restoreGhost(name);
    await loadGhostImage(ghost.src);
    await loadNamedPose(true);
    renderPanel();
    draw();
  }

  /** Aplica a pose nomeada no esqueleto (se existir). */
  async function loadNamedPose(quiet = false): Promise<void> {
    skel.resetPose();
    try {
      const pose = await loadPose(char, poseName);
      for (const [bone, p] of pose.bones) {
        const i = skel.bone(bone);
        const target = skel.pose[i]!;
        target.rotation = p.rot;
        target.offset = { x: p.x, y: p.y };
        target.scale = p.scale;
        if (p.slot !== undefined) target.slot = p.slot;
      }
      status = `pose "${poseName}" carregada (${pose.bones.size} ossos ajustados)`;
    } catch (err) {
      status = quiet ? `pose "${poseName}" ainda não existe: começando do repouso do rig` : (err as Error).message;
    }
  }

  function draw(): void {
    skel.update();
    renderer.clear();
    if (ghost?.visible && ghostImage) {
      const m = multiply(renderer.viewMatrix(), ghostMatrix(ghost));
      const { ctx } = renderer;
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.globalAlpha = ghost.opacity;
      ctx.drawImage(ghostImage, 0, 0);
      ctx.globalAlpha = 1;
    }
    renderer.drawSkeleton(skel, char, { alpha: rigOpacity });
    if (showBones) drawBones(renderer, skel, { selected });
  }

  /** O osso da peça mais de cima sob o ponto (mundo). */
  function pick(wx: number, wy: number): number {
    const list = skel.drawList();
    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i]!;
      const local = apply(invert(item.matrix), { x: wx, y: wy });
      if (alpha(item.part, local.x, local.y) > 100) return item.bone;
    }
    return -1;
  }

  // --- Interação no canvas --------------------------------------------------
  type Drag =
    | { mode: 'rotate'; startAngle: number; startRotation: number }
    | { mode: 'pan' | 'ghost'; sx: number; sy: number; ox: number; oy: number };
  let drag: Drag | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.shiftKey) {
      drag = { mode: 'pan', sx: e.offsetX, sy: e.offsetY, ox: renderer.camera.x, oy: renderer.camera.y };
      return;
    }
    if (movingGhost && ghost) {
      drag = { mode: 'ghost', sx: e.offsetX, sy: e.offsetY, ox: ghost.x, oy: ghost.y };
      return;
    }
    const w = renderer.screenToWorld(e.offsetX, e.offsetY);
    const hit = pick(w.x, w.y);
    if (hit >= 0) selected = hit;
    if (selected < 0) return draw();
    const p = skel.pivotWorld(selected);
    drag = { mode: 'rotate', startAngle: Math.atan2(w.y - p.y, w.x - p.x), startRotation: skel.pose[selected]!.rotation };
    renderPanel();
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const z = renderer.camera.zoom;
    if (drag.mode === 'pan') {
      renderer.camera.x = drag.ox - (e.offsetX - drag.sx) / z;
      renderer.camera.y = drag.oy - (e.offsetY - drag.sy) / z;
    } else if (drag.mode === 'ghost' && ghost) {
      ghost.x = drag.ox + (e.offsetX - drag.sx) / z;
      ghost.y = drag.oy + (e.offsetY - drag.sy) / z;
    } else if (drag.mode === 'rotate') {
      const w = renderer.screenToWorld(e.offsetX, e.offsetY);
      const p = skel.pivotWorld(selected);
      const delta = Math.atan2(w.y - p.y, w.x - p.x) - drag.startAngle;
      // Espelhado, girar no mundo é girar ao contrário no osso.
      skel.pose[selected]!.rotation = drag.startRotation + (skel.root.flip ? -delta : delta);
      updateReadout();
    }
    draw();
  });
  canvas.addEventListener('pointerup', () => {
    if (drag?.mode === 'ghost') {
      saveGhost();
      updateGhostReadout();
    }
    drag = null;
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const k = Math.exp(-e.deltaY * 0.001);
      if (movingGhost && ghost) {
        // Escala o fantasma em volta do ponto sob o cursor (esse ponto da imagem não sai do lugar).
        const w = renderer.screenToWorld(e.offsetX, e.offsetY);
        const img = apply(invert(ghostMatrix(ghost)), w);
        ghost.scale = Math.min(10, Math.max(0.1, ghost.scale * k));
        ghost.ax = img.x;
        ghost.ay = img.y;
        ghost.x = w.x;
        ghost.y = w.y;
        saveGhost();
        updateGhostReadout();
      } else renderer.camera.zoom = Math.min(4, Math.max(0.1, renderer.camera.zoom * k));
      draw();
    },
    { passive: false },
  );

  // --- Painel ---------------------------------------------------------------
  function renderPanel(): void {
    panel.innerHTML = '';
    const head = row();
    const select = el('select') as HTMLSelectElement;
    for (const c of partsIds) select.append(new Option(c, c, false, c === char.name));
    select.onchange = () => void setCharacter(select.value as CharName);
    head.append(
      select,
      button('Pose-imagem', () => (location.search = `?scene=poselab&mode=image&char=${char.name}`)),
      button(skel.root.flip ? 'Desvirar' : 'Virar', () => {
        skel.root.flip = !skel.root.flip;
        renderPanel();
        draw();
      }),
      button(showBones ? 'Ocultar ossos' : 'Ossos', () => {
        showBones = !showBones;
        renderPanel();
        draw();
      }),
    );
    panel.append(head);

    // Fantasma de referência.
    const gbox = el('section', 'lab__box');
    gbox.append(el('strong', '', 'Fantasma de referência'));
    if (ghost) {
      const g = ghost;
      const toggle = row();
      toggle.append(
        button(g.visible ? 'Esconder' : 'Mostrar', () => {
          g.visible = !g.visible;
          saveGhost();
          renderPanel();
          draw();
        }),
        button(movingGhost ? 'Mover fantasma: ligado' : 'Mover fantasma', () => {
          movingGhost = !movingGhost;
          canvas.style.cursor = movingGhost ? 'move' : '';
          renderPanel();
        }),
      );
      if (movingGhost) toggle.lastElementChild!.classList.add('is-on');
      gbox.append(toggle);
      gbox.append(
        slider('Opacidade do fantasma', 0, 1, 0.05, g.opacity, (v) => {
          g.opacity = v;
          saveGhost();
          draw();
        }),
        slider('Opacidade do rig', 0, 1, 0.05, rigOpacity, (v) => {
          rigOpacity = v;
          draw();
        }),
        slider('Escala do fantasma', 0.2, 6, 0.01, g.scale, (v) => {
          g.scale = v;
          saveGhost();
          updateGhostReadout();
          draw();
        }, 'ghost-scale'),
      );
      const files = row();
      const input = el('input') as HTMLInputElement;
      input.type = 'file';
      input.accept = 'image/*';
      input.hidden = true;
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        g.src = URL.createObjectURL(file);
        await loadGhostImage(g.src);
        saveGhost();
        draw();
      };
      files.append(
        input,
        button('Carregar imagem…', () => input.click()),
        button('Folha do personagem', async () => {
          ghost = { ...defaultGhost(char.name), opacity: g.opacity, visible: true };
          await loadGhostImage(ghost.src);
          saveGhost();
          renderPanel();
          draw();
        }),
      );
      gbox.append(files, el('div', 'lab__hint lab__ghost-readout'));
    }
    panel.append(gbox);

    // Pose nomeada.
    const pbox = el('section', 'lab__box');
    pbox.append(el('strong', '', 'Pose'));
    const nameRow = row();
    const nameInput = el('input', 'lab__name') as HTMLInputElement;
    nameInput.value = poseName;
    nameInput.oninput = () => (poseName = nameInput.value.trim() || 'fly_rest');
    nameRow.append(nameInput);
    const actions = row();
    actions.append(
      button('Carregar pose', async () => {
        await loadNamedPose();
        renderPanel();
        draw();
      }),
      button('Salvar pose', async () => {
        try {
          await savePose(char.name, poseName, { name: poseName, ...exportPose() });
          status = `salvo em assets/poses/${char.name}/${poseName}.json`;
        } catch (err) {
          status = (err as Error).message;
        }
        renderPanel();
      }),
    );
    pbox.append(nameRow, actions, el('div', 'lab__hint', status));
    panel.append(pbox);

    // Osso selecionado: rotação, slot.
    const sel = el('section', 'lab__box');
    if (selected >= 0) {
      const bone = skel.rig.bones[selected]!;
      sel.append(el('strong', '', bone.name), el('div', 'lab__readout'));
      if (bone.slots.length) {
        const slot = el('select') as HTMLSelectElement;
        slot.append(new Option('(escondido)', ''));
        for (const s of bone.slots) slot.append(new Option(s, s, false, skel.pose[selected]!.slot === s));
        if (!skel.pose[selected]!.slot) slot.value = '';
        slot.onchange = () => {
          skel.pose[selected]!.slot = slot.value || null;
          draw();
        };
        sel.append(slot);
      }
      sel.append(
        button('Zerar osso', () => {
          skel.pose[selected]!.rotation = 0;
          draw();
          updateReadout();
        }),
      );
    } else sel.append(el('span', 'lab__hint', 'Clique numa peça pra selecionar o osso.'));
    sel.append(
      button('Zerar pose', () => {
        skel.resetPose();
        draw();
        updateReadout();
      }),
    );
    panel.append(sel);

    // Hierarquia.
    const tree = el('ul', 'lab__tree');
    const add = (i: number, depth: number) => {
      const b = skel.rig.bones[i]!;
      const li = el('li', i === selected ? 'is-selected' : '', `${b.layer === 'back' ? '◂ ' : ''}${b.name}`);
      li.style.paddingLeft = `${8 + depth * 14}px`;
      li.title = `${b.part ?? '(sem peça)'} · ${b.layer} · ordem ${b.order}`;
      li.onclick = () => {
        selected = i;
        renderPanel();
        draw();
      };
      tree.append(li);
      for (const c of [...b.back, ...b.front].sort((a, z) => a - z)) add(c, depth + 1);
    };
    for (const r of skel.rig.roots) add(r, 0);
    panel.append(tree);

    // Export.
    const out = el('textarea', 'lab__out') as HTMLTextAreaElement;
    out.readOnly = true;
    out.placeholder = 'JSON exportado aparece aqui';
    const ex = row();
    ex.append(
      button('Exportar pose', () => (out.value = JSON.stringify({ name: poseName, ...exportPose() }, null, 2))),
      button('Exportar rig', () => (out.value = JSON.stringify(exportRig(), null, 2))),
    );
    panel.append(ex, out);
    updateReadout();
    updateGhostReadout();
  }

  function updateReadout(): void {
    const r = panel.querySelector('.lab__readout');
    if (r && selected >= 0) r.textContent = `rotação extra: ${rad2deg(skel.pose[selected]!.rotation).toFixed(1)}°`;
  }

  function updateGhostReadout(): void {
    const r = panel.querySelector('.lab__ghost-readout');
    if (r && ghost) r.textContent = `posição (${ghost.x.toFixed(0)}, ${ghost.y.toFixed(0)}) · escala ${ghost.scale.toFixed(2)}`;
    const s = panel.querySelector<HTMLInputElement>('input[data-id="ghost-scale"]');
    if (s && ghost) s.value = String(ghost.scale);
  }

  /** Pose = só o que mudou em relação ao repouso do rig (graus). */
  function exportPose() {
    const bones: Record<string, { rotate?: number; slot?: string | null }> = {};
    skel.rig.bones.forEach((b, i) => {
      const p = skel.pose[i]!;
      const entry: { rotate?: number; slot?: string | null } = {};
      if (Math.abs(p.rotation) > 1e-4) entry.rotate = round(rad2deg(p.rotation));
      if (p.slot !== (b.hidden ? null : b.part)) entry.slot = p.slot;
      if (Object.keys(entry).length) bones[b.name] = entry;
    });
    return { char: char.name, bones };
  }

  /**
   * Rig com a pose embutida: o ângulo de cada osso no rig é no mundo, então soma-se o giro
   * acumulado (do próprio osso e das mães).
   */
  function exportRig() {
    const spec = structuredClone(char.rigSpec) as { bones: { name: string; angle?: number; rotate?: number }[] };
    const acc = new Map<number, number>();
    const total = (i: number): number => {
      if (acc.has(i)) return acc.get(i)!;
      const b = skel.rig.bones[i]!;
      const v = skel.pose[i]!.rotation + (b.parent >= 0 ? total(b.parent) : 0);
      acc.set(i, v);
      return v;
    };
    spec.bones.forEach((b, i) => {
      const d = rad2deg(total(i));
      if (Math.abs(d) < 1e-4) return;
      if (b.angle !== undefined) b.angle = round(b.angle + d);
      else b.rotate = round((b.rotate ?? 0) + d);
    });
    return spec;
  }

  await setCharacter(wanted);
  // Para screenshots: &rot=bone:graus,…  &select=  &flip=1  &ghost=0.6 (opacidade)  &rigalpha=0.5
  for (const pair of (params.get('rot') ?? '').split(',').filter(Boolean)) {
    const [name, deg] = pair.split(':');
    skel.pose[skel.bone(name!)]!.rotation = deg2rad(Number(deg));
  }
  if (params.get('select')) selected = skel.bone(params.get('select')!);
  if (params.get('flip') === '1') skel.root.flip = true;
  const g = ghost as Ghost | null; // atribuído dentro de setCharacter (o TS não acompanha)
  if (params.get('ghost') && g) g.opacity = Number(params.get('ghost'));
  if (params.get('rigalpha')) rigOpacity = Number(params.get('rigalpha'));
  renderPanel();
  draw();
}

const round = (v: number) => Math.round(v * 10) / 10;

function el(tag: string, className = '', text = ''): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

const row = () => el('div', 'lab__row');

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', '', label) as HTMLButtonElement;
  b.type = 'button';
  b.onclick = onClick;
  return b;
}

function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void, id?: string): HTMLElement {
  const wrap = el('label', 'lab__slider');
  const input = el('input') as HTMLInputElement;
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  if (id) input.dataset['id'] = id;
  input.oninput = () => onInput(Number(input.value));
  wrap.append(el('span', '', label), input);
  return wrap;
}

function injectStyles(): void {
  if (document.getElementById('lab-styles')) return;
  const style = document.createElement('style');
  style.id = 'lab-styles';
  style.textContent = `
    .lab { display: flex; flex-direction: column; gap: 10px; padding: 12px; background: #1c1d27; border-left: 1px solid #2c2e3b; overflow: auto; min-height: 0; }
    .lab__row { display: flex; flex-wrap: wrap; gap: 6px; }
    .lab select, .lab button, .lab__name { background: #2a2c38; color: #e3e4ea; border: 1px solid #3a3d4d; border-radius: 6px; padding: 5px 8px; font: inherit; cursor: pointer; }
    .lab__name { cursor: text; flex: 1; min-width: 0; }
    .lab button:hover { background: #343747; }
    .lab button.is-on { background: #ffd23f; color: #14151c; border-color: #ffd23f; }
    .lab__box { display: flex; flex-direction: column; gap: 6px; padding: 8px; background: #23242f; border-radius: 8px; }
    .lab__slider { display: grid; gap: 2px; font-size: 12px; color: #9a9cb0; }
    .lab__slider input { width: 100%; }
    .lab__readout, .lab__hint { color: #9a9cb0; font-size: 12px; }
    .lab__tree { list-style: none; margin: 0; padding: 0; font-size: 12px; }
    .lab__tree li { padding: 3px 8px; border-radius: 4px; cursor: pointer; color: #c4c6d4; }
    .lab__tree li:hover { background: #2a2c38; }
    .lab__tree li.is-selected { background: #ffd23f; color: #14151c; }
    .lab__out { min-height: 120px; background: #14151c; color: #b9f0c4; border: 1px solid #2c2e3b; border-radius: 6px; font: 11px ui-monospace, monospace; }
  `;
  document.head.append(style);
}

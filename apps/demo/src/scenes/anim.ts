import { Actor, CanvasRenderer, FixedClock, runLoop, SIM_DT, type Character, type ClipData, type PoseTransition, type SkinKind } from '@perolanegra/sprite-fighter';
import { listCharacters, loadCharacter, type CharName } from '../assets';
import { loadClips } from '../clips';
import { loadClipPoses } from '../poses';

/**
 * ?scene=anim&char=neo&clip=brake — cada clipe dentro de um pequeno roteiro de movimento
 * (o tecido reage à velocidade). Com `&t=1.2` a cena é simulada de forma determinística até
 * 1,2 s e congelada (screenshots); sem `t`, roda ao vivo com botões.
 */
interface Beat {
  at: number;
  clip: string;
  fade?: number;
}

interface Scenario {
  beats: Beat[];
  /** Velocidade do corpo (px/s) no tempo t da cena. */
  velocity: (t: number) => { x: number; y: number };
}

const still = () => ({ x: 0, y: 0 });
const smoothstep = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

function scenario(clip: string): Scenario {
  const idle: Beat = { at: 0, clip: 'idle_fly' };
  switch (clip) {
    case 'dash_forward':
      return { beats: [idle, { at: 0.4, clip }, { at: 1.4, clip: 'idle_fly', fade: 14 }], velocity: (t) => ({ x: 1300 * smoothstep(0.5, 0.62, t) * (1 - 0.75 * smoothstep(1.2, 1.7, t)), y: 0 }) };
    case 'dash_back':
      return { beats: [idle, { at: 0.4, clip }, { at: 1.3, clip: 'idle_fly', fade: 14 }], velocity: (t) => ({ x: -750 * smoothstep(0.45, 0.58, t) * (1 - smoothstep(0.9, 1.4, t)), y: 0 }) };
    case 'brake':
      return {
        beats: [idle, { at: 0.1, clip: 'dash_forward' }, { at: 0.9, clip }, { at: 1.9, clip: 'idle_fly', fade: 18 }],
        velocity: (t) => ({ x: 1250 * smoothstep(0.2, 0.32, t) * (1 - smoothstep(0.9, 1.12, t)), y: 0 }),
      };
    case 'knockback_spin':
    case 'recover':
      return {
        beats: [idle, { at: 0.3, clip: 'hurt_heavy', fade: 2 }, { at: 0.38, clip: 'knockback_spin', fade: 3 }, { at: 1.15, clip: 'recover', fade: 4 }, { at: 1.7, clip: 'idle_fly', fade: 14 }],
        velocity: (t) => (t < 0.3 ? still() : { x: -1500 * Math.exp(-3 * (t - 0.3)), y: -200 * Math.exp(-4 * (t - 0.3)) }),
      };
    case 'hurt_light':
    case 'hurt_heavy':
      return {
        beats: [idle, { at: 0.4, clip, fade: 2 }, { at: clip === 'hurt_light' ? 0.85 : 1.1, clip: 'idle_fly', fade: 12 }],
        velocity: (t) => (t < 0.4 ? still() : { x: (clip === 'hurt_light' ? -350 : -800) * Math.exp(-5 * (t - 0.4)), y: 0 }),
      };
    case 'splat':
      return {
        beats: [idle, { at: 0.1, clip: 'dash_forward' }, { at: 0.75, clip, fade: 0 }],
        velocity: (t) => ({ x: t < 0.75 ? 1200 * smoothstep(0.2, 0.32, t) : 0, y: 0 }),
      };
    case 'fall':
      return {
        beats: [idle, { at: 0.4, clip, fade: 10 }],
        velocity: (t) => (t < 0.4 ? still() : { x: 120, y: Math.min(900, 1300 * (t - 0.4)) }),
      };
    default:
      return { beats: [idle, ...(clip === 'idle_fly' ? [] : [{ at: 0.4, clip }])], velocity: still };
  }
}

export async function animScene(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const renderer = new CanvasRenderer(canvas);
  renderer.useWebGL = params.get('gl') !== '0';
  renderer.resize(innerWidth, innerHeight);
  renderer.background = '#1b2333';
  const clips = await loadClips();
  let charName = (params.get('char') as CharName) ?? 'neo';
  let clipName = params.get('clip') ?? 'idle_fly';
  const zoom = Number(params.get('zoom') ?? 0.42);
  let actor!: Actor;
  let plan!: Scenario;
  let sceneTime = 0;
  let beat = 0;
  let camX = 0;

  let char!: Character;
  // Troca de skin agendada (screenshots das transições): &switch=1.0:parts:afterimage
  const [swAt, swTo, swTr] = (params.get('switch') ?? '').split(':');
  let switched = false;
  const reset = async () => {
    actor?.dispose();
    char = await loadCharacter(charName);
    // O voo usa a pose-imagem; ?skin=parts mostra o rig de peças.
    const skin = (params.get('skin') as SkinKind) ?? (char.imagePoses.size ? 'image' : 'parts');
    char.setSkin(skin, { transition: 'cut' });
    switched = false;
    actor = new Actor(char, {
      cloth: params.get('cloth') !== '0',
      hover: params.get('hover') !== '0',
      squash: params.get('squash') !== '0',
    });
    for (const [name, pose] of await loadClipPoses(char, clips.values())) actor.animator.poses.set(name, pose);
    plan = scenario(clipName);
    sceneTime = 0;
    beat = 0;
    camX = 0;
  };

  const step = (dt: number) => {
    if (swAt && !switched && sceneTime >= Number(swAt)) {
      switched = true;
      char.setSkin(swTo as SkinKind, { transition: (swTr as PoseTransition) || 'flash' });
    }
    while (beat < plan.beats.length && plan.beats[beat]!.at <= sceneTime + 1e-9) {
      const b = plan.beats[beat++]!;
      actor.play(clips.get(b.clip) as ClipData, { fade: b.fade, restart: true });
    }
    actor.velocity = plan.velocity(sceneTime);
    actor.step(dt);
    // Câmera segue o personagem (suave, mas determinística: anda junto com a simulação).
    camX += (actor.position.x - camX) * Math.min(1, dt * 6);
    sceneTime += dt;
  };

  const render = (alpha: number) => {
    renderer.camera = { x: camX + 120, y: actor.position.y * 0.6, zoom };
    renderer.clear();
    drawBackdrop(renderer);
    actor.draw(renderer, alpha);
    drawHud(renderer, `${charName} · ${actor.skinKey} · ${clipName} · ${sceneTime.toFixed(2)} s · clipe atual: ${actor.animator.current()?.id ?? '-'}${actor.transition ? ` · transição ${actor.transition.kind}` : ''}`);
  };

  await reset();
  const shotTime = params.get('t');
  if (shotTime !== null) {
    const steps = Math.round(Number(shotTime) / SIM_DT);
    for (let i = 0; i < steps; i++) step(SIM_DT);
    render(1);
    return;
  }

  // Ao vivo: botões dos clipes, personagem, câmera lenta e medidor de FPS.
  const clock = new FixedClock();
  const ui = document.createElement('div');
  ui.className = 'anim-ui';
  ui.innerHTML = `<style>
    .anim-ui { position: fixed; left: 8px; bottom: 8px; display: flex; flex-wrap: wrap; gap: 6px; max-width: calc(100vw - 16px); }
    .anim-ui button, .anim-ui select { background: #2a2c38cc; color: #e3e4ea; border: 1px solid #3a3d4d; border-radius: 6px; padding: 6px 10px; font: inherit; cursor: pointer; }
    .anim-ui button.on { background: #ffd23f; color: #14151c; }
    .anim-ui .fps { padding: 6px 10px; color: #b9f0c4; font: 12px ui-monospace, monospace; }
  </style>`;
  const charSel = document.createElement('select');
  for (const c of (await listCharacters()).map((e) => e.id)) charSel.append(new Option(c, c, false, c === charName));
  charSel.onchange = () => {
    charName = charSel.value as CharName;
    void reset();
  };
  ui.append(charSel);
  for (const id of clips.keys()) {
    const b = document.createElement('button');
    b.textContent = id;
    b.onclick = () => {
      clipName = id;
      ui.querySelectorAll('button.clip').forEach((x) => x.classList.toggle('on', x === b));
      void reset();
    };
    b.className = `clip${id === clipName ? ' on' : ''}`;
    ui.append(b);
  }
  // Troca de skin com transição (o voo usa a pose-imagem; os golpes, o rig de peças).
  const trSel = document.createElement('select');
  for (const t of ['flash', 'afterimage', 'smear', 'cut']) trSel.append(new Option(`transição: ${t}`, t));
  const skinBtn = document.createElement('button');
  const skinLabel = () => (skinBtn.textContent = char.skin === 'image' ? 'skin: image → parts' : 'skin: parts → image');
  skinBtn.onclick = () => {
    if (!char.imagePoses.size) return;
    char.setSkin(char.skin === 'image' ? 'parts' : 'image', { transition: trSel.value as PoseTransition });
    skinLabel();
  };
  skinLabel();
  ui.append(skinBtn, trSel);
  const slow = document.createElement('button');
  slow.textContent = 'câmera lenta';
  slow.onclick = () => {
    clock.timeScale = clock.timeScale === 1 ? 0.25 : 1;
    slow.classList.toggle('on', clock.timeScale !== 1);
  };
  const fps = document.createElement('span');
  fps.className = 'fps';
  ui.append(slow, fps);
  document.body.append(ui);
  let frames = 0;
  let since = performance.now();
  runLoop(
    clock,
    (dt) => step(dt),
    (alpha) => {
      render(alpha);
      frames++;
      const now = performance.now();
      if (now - since >= 1000) {
        fps.textContent = `${Math.round((frames * 1000) / (now - since))} fps`;
        (window as unknown as { __fps: number }).__fps = (frames * 1000) / (now - since);
        frames = 0;
        since = now;
      }
    },
  );
}

/** Fundo com referência de movimento: linhas verticais no mundo e um "chão" de nuvens. */
function drawBackdrop(r: CanvasRenderer): void {
  const { ctx } = r;
  const [s, , , , e, f] = r.viewMatrix();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2 * r.dpr;
  const left = -e / s;
  const right = (r.canvas.width - e) / s;
  for (let x = Math.floor(left / 400) * 400; x < right; x += 400) {
    ctx.beginPath();
    ctx.moveTo(x * s + e, 0);
    ctx.lineTo(x * s + e, r.canvas.height);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, 700 * s + f, r.canvas.width, r.canvas.height);
}

function drawHud(r: CanvasRenderer, text: string): void {
  const { ctx } = r;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `${13 * r.dpr}px system-ui, sans-serif`;
  ctx.fillText(text, 12 * r.dpr, 22 * r.dpr);
}

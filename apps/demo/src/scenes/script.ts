import { SIM_DT, Scene, hasAction, registerAction, type CanvasRenderer, type CastMember } from '@perolanegra/sprite-fighter';
import { checkScene, drawFightDebug } from '@perolanegra/sprite-fighter/authoring';
import { loadCharacter, type CharName } from '../assets';
import { loadClips } from '../clips';
import { cityLayers } from '../backdrop';
import { drawSky, loadMoves } from '../fight';

/**
 * Toca um roteiro JSON só com a API pública (`Scene`): `?scene=script&file=scenes/<nome>.json`
 * (`?scene=chase` = `scenes/chase.json`). O elenco é lido do próprio roteiro (ids do manifesto).
 *
 * Screenshots (sem tocar ao vivo):
 *  - `&t=1.6`: seek direto para 1,6 s;
 *  - `&from=3.2&t=1.6`: primeiro vai a 3,2 s, depois volta (seek) a 1,6 s;
 *  - `&play=1.6`: avança como ao vivo (advance em quadros de 1/60 s) até 1,6 s, sem seek;
 *  - `&at=hit:N±F` / `&at=pose:<id>:N±F`: o N-ésimo contato (ou troca de pose) ± F frames de 60 fps;
 *  - `&debug=1`, `&gl=0`; diagnóstico: `&layers=0` (WebGL composto no canvas 2D), `&bg=0` / `&bg=sky`.
 * Ao vivo: tocar/pausar, barra de tempo (seek), velocidade e laço.
 */
export async function scriptScene(canvas: HTMLCanvasElement, params: URLSearchParams, file: string): Promise<void> {
  // `&api=1` (só na perseguição): a versão da API fluente, que gera o mesmo roteiro.
  const json = (params.get('api') === '1' ? (await import('../chase-api')).chaseScript().toJSON() : await (await fetch(`/${file}`)).json()) as { cast?: Record<string, unknown> };
  const ids = Object.keys(json.cast ?? {}) as CharName[];
  const characters: Record<string, CastMember> = {};
  await Promise.all(ids.map(async (id) => (characters[id] = { character: await loadCharacter(id), moves: await loadMoves(id) })));
  // Ações do app (registerAction no app, declaradas em sf.actions.json) não existem na demo: uma ação
  // vazia no lugar de cada uma, com aviso (como no narrate validate).
  const appActions: string[] = [];
  const declared = (await fetch('/__sf/actions').then((r) => (r.ok ? r.json() : [])).catch(() => [])) as { name: string }[];
  for (const m of Object.values(characters))
    for (const move of m.moves?.values() ?? [])
      for (const ph of move.phases)
        if (ph.run && !hasAction(ph.run)) {
          registerAction(ph.run, () => {});
          appActions.push(`ação do app "${ph.run}" não executada na demo${declared.some((a) => a.name === ph.run) ? '' : ' (e não declarada em sf.actions.json)'}`);
        }
  const still = params.has('t') || params.has('at') || params.has('play');
  const debug = params.get('debug') === '1';
  let scene: Scene;
  const hud = (r: CanvasRenderer) => {
    const d = scene.director!;
    const w = d.world;
    const last = w.hits[w.hits.length - 1];
    const ctx = r.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `${13 * r.dpr}px system-ui, sans-serif`;
    const text = `${d.script.title || file} · ${d.time.toFixed(3)} / ${d.duration.toFixed(2)} s (frame ${Math.round(d.time * 60)}) · ${r.webGL ? 'WebGL' : 'Canvas 2D'} · contatos: ${w.hits.length}${last ? ` (último: ${last.attacker}→${last.target})` : ''}`;
    ctx.fillText(text, 12 * r.dpr, 22 * r.dpr);
    // Avisos do roteiro (variante que falta…), em laranja.
    ctx.fillStyle = '#ffb347';
    const warnings = [...d.warnings, ...appActions];
    warnings.forEach((m, i) => ctx.fillText(`aviso: ${m}`, 12 * r.dpr, (42 + i * 18) * r.dpr));
    if (debug) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      d.fighters.forEach((f, i) => ctx.fillText(`${f.id}: ${f.actor.poseName}${f.actor.variantPose ? `@${f.actor.variantPose.variant}` : ''}`, 12 * r.dpr, (42 + (warnings.length + 1 + i) * 18) * r.dpr));
    }
  };
  scene = await Scene.create(canvas, {
    characters,
    clips: await loadClips(),
    width: innerWidth,
    height: innerHeight,
    // Diagnóstico de desempenho: `&bg=0` sem céu nem paralaxe, `&bg=sky` só o céu.
    ...(params.get('bg') === '0' || params.get('bg') === 'sky' ? {} : { parallax: cityLayers(620) }),
    ...(params.get('bg') === '0' ? {} : { drawBackground: drawSky }),
    drawOverlay: hud,
    webGL: params.get('gl') !== '0',
    layers: !still && params.get('layers') !== '0',
    debug: debug ? drawFightDebug : null,
  });
  // Na demo (autoria), a conferência detalhada dos nomes antes de tocar: erro com a lista do que existe.
  const clips = await loadClips();
  checkScene(json, { characters, clips }, file);
  await scene.load(json, file);

  if (still) {
    const at = params.get('at');
    if (params.has('play')) {
      const until = Number(params.get('play'));
      scene.director!.play();
      while (scene.time < until - 1e-9) scene.director!.advance(Math.min(1 / 60, until - scene.time + SIM_DT / 2));
      scene.director!.pause();
      scene.render(1);
    } else if (at) {
      const spec = at.replace(' ', '+'); // '+' na URL vira espaço
      const hit = /^hit:(\d+)([+-]\d+)?$/.exec(spec);
      const pose = /^pose:([\w-]+):(\d+)([+-]\d+)?$/.exec(spec);
      if (!hit && !pose) throw new Error(`&at= esperado hit:N±frames ou pose:<id>:N±frames (veio "${at}")`);
      const d = scene.director!;
      const reached = () => (hit ? d.world.hits.length >= Number(hit[1]) : d.world.fighter(pose![1]!).actor.poseChanges >= Number(pose![2]));
      d.reset();
      while (!reached() && d.time < d.duration) d.step();
      if (!reached()) throw new Error(`a cena terminou antes de ${at}`);
      scene.seek(d.time + Number((hit ? hit[2] : pose![3]) ?? 0) / 60);
    } else {
      if (params.has('from')) scene.seek(Number(params.get('from')));
      scene.seek(Number(params.get('t')));
    }
    document.body.dataset['time'] = scene.time.toFixed(4);
    return;
  }

  if (params.get('perf') === '1') return measure(scene, Number(params.get('perfSeconds') ?? 5), Number(params.get('warmup') ?? 0.3));

  // Controles ao vivo.
  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;display:flex;gap:6px;align-items:center;color:#e3e4ea;font:13px system-ui';
  const btn = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:#2a2c38cc;color:#e3e4ea;border:1px solid #3a3d4d;border-radius:6px;padding:6px 10px;font:inherit;cursor:pointer';
    b.onclick = fn;
    ui.append(b);
    return b;
  };
  const toggle = btn('pausa', () => (scene.playing ? scene.pause() : scene.play()));
  btn('recomeçar', () => {
    scene.seek(0);
    scene.play();
  });
  btn('câmera lenta', () => (scene.timeScale = scene.timeScale === 1 ? 0.2 : 1));
  const loop = btn('laço: não', () => {
    scene.loop = !scene.loop;
    loop.textContent = `laço: ${scene.loop ? 'sim' : 'não'}`;
  });
  const bar = document.createElement('input');
  bar.type = 'range';
  bar.min = '0';
  bar.max = String(scene.duration);
  bar.step = String(1 / 60);
  bar.style.flex = '1';
  bar.oninput = () => {
    scene.pause();
    scene.seek(Number(bar.value));
  };
  ui.append(bar);
  document.body.append(ui);
  const tick = () => {
    if (document.activeElement !== bar) bar.value = String(scene.time);
    toggle.textContent = scene.playing ? 'pausa' : 'tocar';
    requestAnimationFrame(tick);
  };
  tick();
  scene.play();
}

/** `&perf=1`: toca ao vivo e mede o custo de cada quadro (avanço + desenho); resultado em body[data-perf]. */
function measure(scene: Scene, seconds: number, warmup: number): void {
  const d = scene.director!;
  const costs: number[] = [], gaps: number[] = [], dropAt: number[] = [];
  let last = 0;
  const split = { advance: 0, render: 0 };
  d.play();
  const frame = (now: number) => {
    const dt = last ? (now - last) / 1000 : 0;
    const a = performance.now();
    const alpha = d.advance(dt);
    const b = performance.now();
    scene.render(alpha);
    const cost = performance.now() - a;
    if (d.time >= warmup) {
      split.advance += b - a;
      split.render += cost - (b - a);
    }
    if (d.time >= warmup && last) {
      gaps.push(now - last);
      if (now - last >= 25) dropAt.push(+d.time.toFixed(2));
      costs.push(cost);
    }
    last = now;
    if (d.time < seconds && d.playing) return void requestAnimationFrame(frame);
    const sorted = [...costs].sort((x, y) => x - y), sg = [...gaps].sort((x, y) => x - y);
    const q = (arr: number[], k: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * k))]!;
    const avg = (arr: number[]) => arr.reduce((x, y) => x + y, 0) / arr.length;
    document.body.dataset['perf'] = JSON.stringify({
      renderer: scene.renderer.webGL ? 'webgl' : 'canvas2d',
      frames: costs.length,
      fps: 1000 / avg(gaps),
      frameMsAvg: avg(costs),
      frameMsP95: q(sorted, 0.95),
      frameMsMax: sorted[sorted.length - 1],
      gapMsP95: q(sg, 0.95),
      dropped: gaps.filter((g) => g >= 25).length,
      dropAt,
      over16ms: costs.filter((c) => c > 16.7).length,
      perFrameMs: { avanço: +(split.advance / costs.length).toFixed(2), desenho: +(split.render / costs.length).toFixed(2) },
    });
  };
  requestAnimationFrame(frame);
}

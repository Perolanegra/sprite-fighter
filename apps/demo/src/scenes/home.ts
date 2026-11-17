import { listCharacters } from '../assets';

/**
 * Página inicial do lab (sem `?scene=`): os personagens do projeto (tira de poses, Pose Lab, debug) e
 * as cenas em scenes/, com links. Os dados vêm das rotas /__sf/characters e /__sf/scenes.
 */
export async function homeScene(canvas: HTMLCanvasElement): Promise<void> {
  const app = canvas.parentElement!;
  const chars = await listCharacters();
  const scenes = (await fetch('/__sf/scenes').then((r) => (r.ok ? r.json() : [])).catch(() => [])) as string[];
  const link = (href: string, text: string) => `<a href="?${href}">${text}</a>`;
  app.innerHTML = `<main class="home">
    <h1>sprite-fighter · lab</h1>
    <h2>Personagens</h2>
    ${
      chars.length
        ? `<ul>${chars
            .map(
              (c) =>
                `<li><strong>${c.id}</strong> · ${link(`scene=skin&char=${c.id}&mode=strip`, 'tira de poses')} · ${link(`scene=poselab&mode=image&char=${c.id}`, 'Pose Lab')} · ${link(`scene=skin&char=${c.id}&mode=debug`, 'malha e ossos')} · ${link(`scene=variants&char=${c.id}`, 'variantes')}${c.parts ? ` · ${link(`scene=poselab&char=${c.id}`, 'rig de peças')}` : ''}</li>`,
            )
            .join('')}</ul>`
        : '<p>Nenhum personagem ainda: escreva <code>skins/&lt;id&gt;.json</code> e rode <code>npx sf pose:add</code>.</p>'
    }
    <h2>Cenas</h2>
    ${scenes.length ? `<ul>${scenes.map((s) => `<li>${link(`scene=script&file=scenes/${s}.json`, s)} · ${link(`scene=script&file=scenes/${s}.json&debug=1`, 'debug')}</li>`).join('')}</ul>` : '<p>Nenhuma cena em <code>scenes/</code>.</p>'}
  </main>
  <style>.home { font: 15px/1.6 system-ui, sans-serif; color: #e3e4ea; max-width: 760px; margin: 32px auto; padding: 0 16px; } .home a { color: #8fc8ff; } .home code { color: #ffd23f; }</style>`;
}

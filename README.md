# sprite-fighter

Biblioteca TypeScript que transforma imagens 2D de um personagem em **cenas de luta roteirizadas** com a
linguagem visual dos jogos de luta 2D estilo DBZ: voo livre, golpes com contato (hitbox), hitstop, tremida de
câmera, rastro, borrão de movimento e tecido que balança.

**Não é um jogo.** Não há jogador, teclado nem IA: tudo é dirigido por um **roteiro** (JSON ou API TS). A mesma
cena roda sempre igual (determinística), então dá para pular para qualquer instante (`seek`).

Cada personagem é uma **biblioteca de poses-chave em imagem** (voo, soco, chute, levando golpe…). Cada pose tem
um esqueleto próprio que deforma a imagem (malha + pesos, WebGL com fallback Canvas 2D), e todas as poses de
um personagem usam os mesmos nomes de ossos. A troca de pose passa por uma transição (borrão na ida, rastro na
volta) e não pula: a âncora é o quadril, e a escala de cada pose é normalizada pela altura da cabeça.

- [Instalação](#instalação)
- [Uso no Angular](#uso-no-angular)
- [Uso sem framework](#uso-sem-framework)
- [Formatos](#formatos): [manifesto](#manifesto-do-personagem), [esqueleto da pose](#esqueleto-da-pose-skinjson), [golpe](#golpe-movesidmovesjson), [roteiro](#roteiro-scenesnomejson)
- Guias: [novo personagem](#guia-novo-personagem) · [nova pose](#guia-nova-pose) · [nova variante](#guia-nova-variante) · [novo golpe](#guia-novo-golpe) · [nova cena](#guia-nova-cena)
- [Ferramentas](#ferramentas) · [Demo](#demo-e-parâmetros) · [Orçamento](#orçamento-e-medições) · [Limites conhecidos](#limites-conhecidos)
- [Apêndice: rig de peças (opcional)](#apêndice-rig-de-peças-opcional)

---

## Instalação

### Pacotes

| Pacote | O que é |
|---|---|
| `@perolanegra/sprite-fighter` | o player (sem dependências) e a entrada `@perolanegra/sprite-fighter/authoring` (conferência detalhada, schema, API fluente, debug) |
| `@perolanegra/ngx-sprite-fighter` | o componente Angular `<sf-scene>` (Angular 21: peers `@angular/core` e `@angular/common` `^21`) |
| `@perolanegra/sprite-fighter-cli` | o CLI `sf`: `init`, `lab`, poses (`pose:add`, `pose:list`, `normalize`, `sheet`) e narrador (`catalog`, `validate`, `missing`, `preview`) |

Os três andam com a mesma versão (semver, começando em 0.1.0; mudanças de API no [`CHANGELOG.md`](CHANGELOG.md)).
Os assets dos personagens **não** vão nos pacotes: o CLI trabalha na pasta de assets do seu app.

### Instalar num app (GitHub Packages)

Os pacotes ficam no GitHub Packages, que pede um token mesmo para ler.

1. Crie um token clássico em GitHub → Settings → Developer settings → Personal access tokens, só com o
   escopo **`read:packages`**.
2. No app, um `.npmrc` que aponta o escopo `@perolanegra` para o GitHub Packages e lê o token de uma variável de
   ambiente (assim o token não vai para o repositório):

   ```ini
   @perolanegra:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
   ```

3. Instale (com `GITHUB_TOKEN` definido no terminal ou no CI):

   ```bash
   export GITHUB_TOKEN=ghp_…            # o token de leitura
   npm i @perolanegra/sprite-fighter @perolanegra/ngx-sprite-fighter
   npm i -D @perolanegra/sprite-fighter-cli
   npx sf init --assets public/sf        # num app Angular, os arquivos estáticos ficam em public/
   ```

O `sf init` cria a pasta de assets (`skins/`, `poses/`, `moves/`, `scenes/` e os clipes genéricos em `clips/`), o
`sf.config.json` (que guarda a pasta para os outros comandos), um `sf.actions.json` de exemplo e o comando
`/narrate` em `.claude/commands/`. Com `--assets public/sf`, o app lê tudo em `sf/…`
(`<sf-scene … script="sf/scenes/x.json" clips="sf/clips/index.json">`, personagem `{ poses: 'sf/skins/<id>.json' }`).
Deixe as imagens-fonte (PNG) fora de `public/`, para não irem no build do app.

**npm 11.** Num app Angular 21 recém-criado, o npm 10.9 falha com `Cannot read properties of null (reading
'edgesOut')`. É um defeito do npm com os peers opcionais do Vitest no `@angular/build`, não dos pacotes. Use
o npm 11 (`npx npm@11 install` ou `npm i -g npm@11`), ou fixe a família do Vitest em `overrides` (como o
`package.json` deste repositório).

### Testar com os .tgz (sem publicar)

```bash
npm run pack:all                      # compila e gera dist/packs/*.tgz (os 3 pacotes)
cd <seu-app>
npm i <repo>/dist/packs/perolanegra-sprite-fighter-0.1.0.tgz \
      <repo>/dist/packs/perolanegra-ngx-sprite-fighter-0.1.0.tgz \
      <repo>/dist/packs/perolanegra-sprite-fighter-cli-0.1.0.tgz
npx sf init --assets public/sf
```

O `pack:all` também confere três coisas: o player sem dependências, as versões iguais e nenhum asset de
personagem dentro dos pacotes.

### Publicar

1. Suba a versão nos três `package.json` (`packages/core`, `packages/angular`, `packages/cli`), na dependência
   do CLI e no peer do Angular (`^<versão>`), e em `VERSION` (`packages/core/src/index.ts`). Registre as
   mudanças de API no `CHANGELOG.md`.
2. Commit, tag e push:

   ```bash
   git tag v0.1.0
   git push origin main v0.1.0
   ```

3. O workflow `.github/workflows/publish.yml` roda na tag. Ele confere se a tag é igual à versão dos pacotes,
   compila, testa e publica os três no GitHub Packages, com o `GITHUB_TOKEN` do próprio workflow (permissão
   `packages: write`). Os pacotes aparecem em github.com/Perolanegra?tab=packages.

### Desenvolver no repositório

Requisitos: Node 22+ e npm 10+ (npm 11 recomendado).

```bash
npm install
npx playwright install chromium   # screenshots, prévias e medições (dev)
npm run build                      # core, demo, CLI (com o lab), lib Angular e app de exemplo
npm test                           # Vitest
npm run dev                        # demo em http://localhost:5180 (com os assets de assets/)
```

| Pasta | O que é |
|---|---|
| `packages/core` | `@perolanegra/sprite-fighter` |
| `packages/angular` | `@perolanegra/ngx-sprite-fighter` (o pacote sai em `packages/angular/dist`) |
| `packages/cli` | `@perolanegra/sprite-fighter-cli` (`src/atlas`, `src/narrator`, `src/lab`, `templates/`; `lab/` é a demo compilada) |
| `apps/demo` | demo Vite: cenas, Pose Lab, screenshots e medições (no modo `lab`, vira o `sf lab`) |
| `apps/ng-example` | app Angular de exemplo (porta 4300) |
| `assets/` | os personagens do repositório (neo, smith): manifestos, poses, golpes, clipes e cenas |

No repositório, `npx sf …` usa `assets/` (o bin do CLI é ligado pelos workspaces). Os scripts antigos
continuam como apelidos: `npm run pose:add -- …`, `npm run narrate -- validate …`.

---

## Uso no Angular

```ts
import { SfSceneComponent, type SfCharacters } from '@perolanegra/ngx-sprite-fighter';

// Por id: o manifesto das poses e os golpes (URLs). O id é o nome do arquivo do manifesto.
const cast: SfCharacters = {
  neo: { poses: 'skins/neo.json', moves: 'moves/neo.moves.json' },
  smith: { poses: 'skins/smith.json', moves: 'moves/smith.moves.json' },
};
```

```html
<sf-scene #scene [characters]="cast" script="scenes/chase.json" clips="clips/index.json"
          [autoplay]="true" [loop]="false" (hit)="onHit($event)" (end)="onEnd()" (loadError)="erro = $event.message" />
```

| Input | Padrão | |
|---|---|---|
| `characters` | obrigatório | por id: `{ poses, moves?, atlas?, rig? }` (URLs) ou `{ character, moves }` já carregado |
| `script` | obrigatório | URL do roteiro, o próprio JSON ou `script(…).toJSON()` |
| `clips` | `null` | URL do `clips/index.json` ou o mapa já carregado (`idle_fly`, `hurt_light`… usados por golpes e roteiros) |
| `autoplay`, `loop`, `debug` | `false` | `loop`, `debug` e `timeScale` mudam ao vivo. O desenho de debug vem de `@perolanegra/sprite-fighter/authoring`, baixado só quando `debug` liga (import dinâmico, fora do bundle principal) |
| `timeScale` | `1` | câmera lenta < 1 |
| `webgl` | `true` | `false` força o Canvas 2D |
| `playOnVisible` | `false` | toca quando metade da cena entra na tela e pausa quando sai |
| `parallax`, `background`, `overlay` | `null` | cenário: camadas de paralaxe (`ParallaxLayer[]`), fundo e HUD (funções de desenho) |

| Output | Quando |
|---|---|
| `(ready)` | cena carregada: `{ scene, duration, title }` |
| `(step)` | um passo do roteiro começou ou terminou (`StepEvent`) |
| `(hit)` | contato (`HitEvent`: atacante, alvo, golpe, ponto) |
| `(end)` | a cena terminou |
| `(loadError)` | falha ao carregar (mensagem com o arquivo e o campo) |

Métodos (pegue o componente com `viewChild`): `play()`, `pause()`, `seek(t)`; leitura: `time`, `duration`,
`playing`, `scene` (o `Scene` do core).

O laço de quadros roda **fora da zona** do Angular (sem detecção de mudanças por quadro); os outputs voltam à
zona só quando emitem. O componente se ajusta ao tamanho do host (padrão `aspect-ratio: 16/9`) e ao DPR, guarda
os assets num cache (`SfAssets`, por URL) e libera tudo ao ser destruído (laço, texturas, contexto WebGL,
observers). Detalhes em [`packages/angular/README.md`](packages/angular/README.md); exemplo completo em
`apps/ng-example` (`npm run ng:start`).

---

## Uso sem framework

```ts
import { Character, Scene, parseClip, parseMoves, type CastMember } from '@perolanegra/sprite-fighter';

const json = async (url: string) => (await fetch(url)).json();

async function castMember(id: string): Promise<CastMember> {
  const character = await Character.load({ poses: `skins/${id}.json` }); // só poses-imagem (modo principal)
  const moves = parseMoves(await json(`moves/${id}.moves.json`), `golpes ${id}`);
  return { character, moves };
}

const ids: string[] = await json('clips/index.json');
const clips = new Map(await Promise.all(ids.map(async (id) => [id, parseClip(await json(`clips/${id}.json`), id)] as const)));

const canvas = document.querySelector('canvas')!;
const scene = await Scene.create(canvas, {
  characters: { neo: await castMember('neo'), smith: await castMember('smith') },
  clips,
  width: 1280,
  height: 720,
});
await scene.load('scenes/chase.json');  // ou o JSON, ou script(…).toJSON()
scene.on('hit', (e) => console.log(e.attacker, '→', e.target, e.move));
scene.on('end', () => console.log('fim'));
scene.play();

// scene.pause(); scene.seek(1.6); scene.timeScale = 0.25; scene.loop = true;
// scene.resize(w, h, dpr); scene.destroy();
```

`Scene.create(canvas, options)`:

| Opção | |
|---|---|
| `characters` | `{ <id>: { character, moves? } }` (o id é o do roteiro) |
| `clips` | `Map<id, ClipData>` |
| `width`, `height` | tamanho em px CSS (o DPR vem do navegador) |
| `parallax`, `drawBackground`, `drawOverlay` | cenário e HUD |
| `webGL` (`true`), `layers` (`true`) | WebGL ou Canvas 2D; camadas no DOM |
| `debug` (`null`) | desenho de debug: `drawFightDebug` de `@perolanegra/sprite-fighter/authoring` (ossos, hurtboxes, hitboxes, pose e fase). `scene.debug` muda ao vivo |

Eventos (`scene.on`): `hit`, `hit:<a>-><b>`, `step`, `phase`, `moveEnd`, `spawn`, `fx`, `camera`, `warning`,
`end`. `scene.director` é o `Director`, que também roda **sem navegador** (`Director.create(json, { characters, clips })`,
`advance(dt)`, `seek(t)`, `duration`, `unfired()`): é o que o `narrate validate` usa para a simulação seca.

O player confere o formato do roteiro na carga e falha com mensagem clara quando um nome não existe na hora
de usar (pose, golpe, clipe, prop). A **conferência detalhada**, que lista o que existe ("`neo` não tem o
golpe `jabb` (golpes: jab, kick, …)"), fica na entrada de autoria; use-a em desenvolvimento:

```ts
import { checkScene, drawFightDebug } from '@perolanegra/sprite-fighter/authoring';

checkScene(json, { characters, clips }, 'scenes/chase.json'); // lança DataError com o campo e a lista
const scene = await Scene.create(canvas, { characters, clips, debug: drawFightDebug });
```

### `@perolanegra/sprite-fighter/authoring`

O pacote tem duas entradas. `sprite-fighter` é o **player** (o que uma página precisa para tocar cenas).
`@perolanegra/sprite-fighter/authoring` é o que serve para escrever e conferir cenas, e não entra no bundle de quem não o
importa:

| Export | |
|---|---|
| `checkScene(roteiro, { characters, clips })`, `checkScript(roteiro, catálogo)` | conferência detalhada dos nomes (poses, golpes, clipes, efeitos, props) |
| `scriptSchema()`, `COMMAND_DOCS` | JSON Schema do roteiro e a descrição de cada comando e parâmetro |
| `script(…)` | API fluente (abaixo) |
| `drawFightDebug`, `drawSkinDebug` | desenho de debug (luta; malha e pesos de uma pose) |
| `Reader` | leitor de JSON com mensagens por campo (o dos formatos do core) |

**Roteiro pela API fluente** (gera o mesmo JSON e passa pela mesma validação):

```ts
import { script } from '@perolanegra/sprite-fighter/authoring';

const s = script({ title: 'fuga', seed: 3 })
  .cast('neo', { at: [-160, 560], scale: 0.32 })
  .cast('smith', { at: [-700, 520], scale: 0.32 })
  .at(0).actor('neo').moveTo('M -160 560 C 500 420 1100 560 1500 520', 1.6, { ease: 'sineIn' }).as('fuga')
  .then(0.2).actor('smith').move('shoot', { target: 'neo' })   // 0,2 s depois que "fuga" termina
  .on('hit:smith->neo').actor('neo').pose('hurt');
await scene.load(s.toJSON());
```

Comandos seguidos sem gatilho novo começam juntos; `then(delay)` encadeia no último, `after(id, delay)` num
passo nomeado com `as(id)`, `on(evento, { nth })` num evento; `actor(null)` para comandos sem ator. A versão
completa da perseguição está em `apps/demo/src/chase-api.ts`.

**Outras peças da API** (todas exportadas por `sprite-fighter`):

- `Character.load({ poses })` / `{ atlas, rig, poses }`; `character.loadPose(nome)`, `setPose(nome, { transition })`,
  `loadVariant(pose, variante)`; `Character.fromPoses(manifesto, carregadores)` (Node, sem navegador).
- `registerAction(nome, fn)`: ação TS chamada pelo `run` de uma fase de golpe (ver [novo golpe](#guia-novo-golpe)).
- `registerProp(tipo, { states, solid, actions, draw })`: tipo de prop novo (os embutidos são `door` e `wall`).
- `parseManifest`, `parseSkin`, `parseMoves`, `parseClip`, `parseScript`, `COMMANDS` (tipos dos parâmetros).
- `World`, `Actor`, `CanvasRenderer`, `CameraRig`, `Effects`: as camadas de baixo, se precisar montar algo fora do `Scene`.

---

## Formatos

Todos os arquivos de autoria são JSON validados na carga. Um erro diz o arquivo, o caminho do campo e o que é
aceito (ex.: `roteiro chase: steps[0].params.transition: esperado um de: smear, afterimage, flash, cut`).
Tempos de roteiro em **segundos**; tempos de golpe em **frames de 60 fps**; posições em px do mundo; ângulos
em graus.

### Manifesto do personagem

`<assets>/skins/<id>.json` (`<assets>` é a pasta de assets do projeto: a do `sf.config.json` ou `assets/`). O
**id é o nome do arquivo**, e a pasta das poses (`dir`) termina sempre no id.

```jsonc
{
  "default": "fly",                       // pose base (âncora, escala de referência, volta dos golpes)
  "dir": "poses/<coleção>/<id>",          // relativo a assets/
  "character": {                          // vai em todo prompt de imagem
    "name": "Neo",
    "description": "homem jovem, cabelo castanho curto, sobretudo longo bege-creme…",
    "style": "anime detalhado de jogo de luta 2D, contorno escuro fino, sombreamento em cel…",
    "styleRefs": ["poses/<coleção>/<id>/src/fly.png"]   // imagens para anexar na IA de imagem
  },
  "poses": [
    { "name": "fly", "description": "voando na horizontal, de bruços…", "tags": ["voo", "base"] },
    { "name": "shoot", "description": "…", "tags": ["tiro"],
      "variants": [ { "name": "nogun", "kind": "hand", "description": "mão vazia", "tags": ["mão"] } ] }
  ],
  "provisional": {                        // poses usadas antes de existir a imagem
    "dodge": { "from": "fly", "rotate": -24, "sx": 0.92, "sy": 1.06, "dx": 0, "dy": -10,
               "description": "desvia jogando o corpo para cima…", "tags": ["esquiva"] }
  }
}
```

- **Pose:** `<dir>/<pose>.webp` (+ `@2x.webp`, usada só com DPR > 1,5), o esqueleto `<pose>.skin.json` e a
  fonte `src/<pose>.png`. `description` (uma frase, pt-BR) e `tags` (minúsculas) servem ao narrador e aos prompts.
- **Provisória:** usa a imagem e a malha de `from` com uma variação na raiz (`rotate` em graus, `sx`/`sy`,
  `dx`/`dy`). No debug aparece "PROVISÓRIA ← from", em laranja. Quando a imagem chega (`pose:add`), ela sai de
  `provisional` e vira pose.
- **Variante:** `<pose>@<variante>.webp`, a mesma pose com outra imagem (expressão, mão), no mesmo enquadramento;
  reusa esqueleto, malha e pesos. `kind` diz qual comando do roteiro a escolhe (`expression` ou `hand`).
- Uma pose pode estar em `poses` antes de ter imagem (o `pose:list` mostra "SEM IMAGEM" e imprime o prompt).
  Assim começa um personagem novo.

### Esqueleto da pose (`skin.json`)

`<dir>/<pose>.skin.json`, gerado pelo `pose:add` e ajustado no Pose Lab. Coordenadas em px da imagem 1x.

```jsonc
{
  "version": 1, "char": "<id>", "pose": "kick", "image": "kick.webp", "image2x": "kick@2x.webp",
  "scale": 1.033,                                        // px do mundo por px da imagem
  "measure": { "headTop": [430, 8], "chin": [480, 175] }, // altura da cabeça → escala normalizada
  "mesh": { "target": 650, "boundaryStep": 5, "seed": 1 },
  "bones": [
    { "name": "hips", "parent": null, "head": [420, 360], "tail": [430, 320], "limit": 12 },
    { "name": "thigh_back", "parent": "hips", "head": [380, 400], "tail": [310, 470], "limit": 12, "follow": "thigh_front" },
    …
  ],
  "chains": [ { "name": "coat", "bones": ["coat_tail_1", "coat_tail_2", "coat_tail_3"], "stiffness": 0.3, "damping": 0.22 } ]
}
```

- **Ossos do corpo** (iguais em todos os personagens; clipes e hitboxes usam esses nomes): `hips`, `torso`,
  `neck`, `head`, `arm_front_upper`, `arm_front_fore`, `hand_front`, `arm_back_upper`, `arm_back_fore`,
  `hand_back`, `thigh_front`, `shin_front`, `foot_front`, `thigh_back`, `shin_back`, `foot_back`. A raiz é
  `hips` (a âncora).
- **Tecido:** ossos extras em `chains` (ex.: `coat_tail_1..3`, `tie_1..3`), que balançam com mola.
- `limit`: quanto o osso pode girar a partir da pose desenhada (graus; membros 12, tecido 25).
- `follow`: o osso copia a rotação de outro (membros sobrepostos no desenho, como a perna de trás).
- **Todas as poses de um personagem precisam dos mesmos ossos**, com as mesmas mães (a carga recusa).

### Golpe (`moves/<id>.moves.json`)

Uma lista de golpes. Cada golpe é uma sequência de **fases**, em frames de 60 fps:

`poses` lista as poses que o golpe usa (carregadas antes da cena).

```json
[
  {
    "id": "jab",
    "poses": ["punch"],
    "phases": [
      { "name": "preparo", "frames": 4, "pose": "punch",
        "motion": { "type": "dash", "velocity": [900, 0], "drag": 10 } },
      { "name": "ativo", "frames": 5, "hitboxes": [{ "bone": "hand_front", "radius": 36, "along": [0.2, 1] }] },
      { "name": "recuperar", "frames": 8 },
      { "name": "voltar", "frames": 8, "pose": "fly" }
    ],
    "onHit": { "hitstop": 6, "knockback": [520, 0], "drag": 8, "stun": 20,
               "targetPose": "hurt_light", "targetClip": "hurt_light", "fx": ["impact_small"] }
  }
]
```

| Campo da fase | |
|---|---|
| `name`, `frames` | obrigatórios |
| `pose`, `transition` | troca a pose na entrada da fase. Sem `transition`: `smear` ao sair da base, `afterimage` ao voltar; `cut` só se pedido |
| `hitboxes` | `[{ bone, radius, along: [0, 1] }]`: cápsula ao longo do osso, ativa só nesta fase; acerta cada alvo uma vez por fase |
| `motion` | `{ type: "dash", velocity: [frente, y], drag }`, `{ type: "offset", by: [x, y], ease }` ou `{ type: "stop" }` |
| `spawn` | projétil: `{ projectile: "bullet" \| "blast", from: <osso>, speed, radius, life, aim, onHit? }` |
| `aim` | 0..1: o braço da frente mira o alvo (IK) |
| `fx`, `camera` | efeitos (ver [efeitos](#efeitos)) e câmera (`{ shake, zoom, follow, pan, auto, frames \| seconds }`) |
| `clip` | clipe tocado nos ossos da pose atual |
| `run` | ação TS (`registerAction`): `"run": "<ação>"` ou `"run": { "action": "<ação>", "params": { … } }`; os `params` chegam em `ctx.params` |

`onHit`: `hitstop` (frames congelados), `knockback` ([x, y] px/s, x no sentido do atacante), `drag`, `stun`
(frames até o alvo voltar à pose base), `targetPose` (pose **do alvo**), `targetTransition`, `targetClip`, `fx`,
`camera`. O golpe vira para o alvo só se ataca (tem hitbox ou projétil).

### Roteiro (`scenes/<nome>.json`)

```json
{
  "title": "o rival acerta um soco no agente",
  "seed": 1,
  "tail": 0.6,
  "cast": {
    "smith": { "at": [420, 600], "scale": 0.4, "facing": -1, "clip": "idle_fly" },
    "rival": { "at": [-200, 600], "scale": 0.4, "clip": "idle_fly" }
  },
  "camera": { "mode": "auto", "maxZoom": 0.7, "margin": 140 },
  "steps": [
    { "id": "chega", "at": 0.2, "actor": "rival", "do": "moveTo", "params": { "to": [220, 600], "duration": 0.6, "ease": "power2Out" } },
    { "id": "soco", "after": "chega", "actor": "rival", "do": "move", "params": { "id": "jab", "target": "smith" } },
    { "on": "hit:rival->smith", "actor": "rival", "do": "say", "params": { "text": "Peguei!", "seconds": 1 } }
  ]
}
```

`seed` é a semente do RNG da cena (faíscas, tremida): mesma semente, mesma cena. A cena dura até o fim do
último passo mais `tail` s (padrão 0,8), ou `duration` fixo. O `cast` é também a ordem de desenho.

**Elenco** (`cast.<id>`): `at` ([x, y], padrão [0, 0]), `scale` (1; ≈ 0,3–0,45 numa cena aberta), `facing`
(1 = direita, −1 = esquerda), `pose` (padrão: a base do manifesto), `clip` (em laço desde o início, ex.:
`idle_fly`), `opacity` (1), `collideProps` (true).

**Gatilho** (exatamente um por passo; `delay` em s soma em qualquer um):

| | Quando o passo começa |
|---|---|
| `"at": 1.2` | no instante 1,2 s |
| `"after": "<id>"` | quando o passo `<id>` **termina** |
| `"on": "<evento>"`, `"nth": 2` | na n-ésima ocorrência do evento (padrão 1) |

**Eventos** para `on`: `hit` (qualquer contato) ou `hit:<atacante>-><alvo>` (o atacante pode ser um prop:
`hit:door->smith`), `incoming:<dono>-><alvo>` (projétil chegando perto, bom para esquivas), `spawn:<dono>`
(disparo), `moveEnd:<id>` (golpe terminou), `start:<passo>`, `done:<passo>`. Num passo `on`, `fx` sai no
ponto do evento.

**Comandos** (`do`) e parâmetros (`params`):

| Comando | Ator | Parâmetros | |
|---|---|---|---|
| `pose` | sim | `name`\*, `transition` (`smear`, `afterimage`, `flash`, `cut`), `skin` (`image`/`parts`) | troca a pose-chave |
| `move` | sim | `id`\*, `target` | executa um golpe; termina com ele |
| `moveTo` | sim | `to` [x, y] **ou** `route` ("M x y C …"), `duration`\*, `ease`, `relative`, `scaleTo` | vai até um ponto ou percorre uma rota; `scaleTo` dá profundidade |
| `dash` | sim | `velocity`\* [frente, y], `drag`, `duration` | impulso com arrasto e rastro |
| `hover` | sim | | flutua parado |
| `fall` | sim | `vx`, `vy`, `gravity` | cai com gravidade (não termina) |
| `face` | sim | `target` **ou** `dir` (1/−1) | vira para alguém ou para um lado |
| `play` | sim | `clip`\*, `fade`, `speed` | toca um clipe nos ossos da pose atual |
| `expression` | sim | `name`\* (variante ou `"none"`) | variante de expressão da pose atual e das próximas que a tiverem |
| `hand` | sim | `name`\* (variante ou `"none"`) | variante de mão, idem |
| `opacity` | sim | `value`\* 0..1 | some/aparece |
| `say` | sim | `text`\*, `seconds` (1,5) | balão de fala |
| `enter` | sim | `prop`\*, `duration`\*, `ease` | atravessa o prop (porta), recortado na passagem |
| `touch` | sim | `prop`\*, `gap` | encosta a frente do corpo no prop |
| `camera` | não | `mode` (`auto`/`follow`/`pan`), `follow`, `pan`, `targets`, `zoom`, `seconds`, `shake`, `margin`, `minZoom`, `maxZoom`, `snap` | câmera |
| `fx` | opcional | `type`\*, `at`, `dir` + os do efeito | efeito (ver abaixo) |
| `spawnProp` | não | `type`\* (`door`, `wall`), `id`, `at`\* (canto de cima à esquerda), `size`\*, `state`, `appear` | cria um prop |
| `prop` | não | `id`\*, `action`\* (porta: `open`/`close`; ou `remove`), `duration` | muda um prop |
| `wait` | não | `seconds`\* | só espera (para encadear com `after`) |
| `parallel` | opcional | `steps`: passos com `delay` | vários juntos; termina quando todos terminam; os filhos herdam o ator |

\* obrigatório. A lista oficial é a tabela `COMMANDS` de `packages/core/src/script.ts` (tipos e
obrigatórios), com a descrição de cada parâmetro em `COMMAND_DOCS` (`packages/core/src/script-docs.ts`); as duas
aparecem juntas em `npx sf catalog` e em `scriptSchema()`.

Exemplo de reação a um evento (da perseguição, `assets/scenes/chase.json`):

```jsonc
{ "id": "splat", "on": "hit:door->smith", "actor": "smith", "do": "parallel", "params": { "steps": [
    { "do": "hover" },
    { "do": "pose", "params": { "name": "splat", "transition": "cut" } },
    { "do": "touch", "params": { "prop": "door" } },
    { "do": "fx", "params": { "type": "impact_big" } },
    { "do": "fx", "params": { "type": "hitstop", "frames": 9 } } ] } },
{ "after": "splat", "delay": 0.4, "actor": "smith", "do": "pose", "params": { "name": "fall" } }
```

#### Efeitos

Usados em `fx` dos golpes, do `onHit` e do roteiro: um nome (`"impact_small"`) ou `{ "type": …, … }`.

| Tipo | Parâmetros (padrão) |
|---|---|
| `impact` | `size` (1), `color` | estrela de impacto com anel e faíscas |
| `spark` | `count` (10), `size` (1) |
| `muzzle` | `bone` (`hand_front`), `size` (0,45): clarão de cano |
| `flash` | `frames` (3), `color` (`#ffffff`): silhueta pintada |
| `afterimage` | `frames` (12), `every` (2), `life` (12), `alpha` (0,5), `tint`: cópias ficando para trás |
| `smear` | `frames` (3): borrão de movimento |
| `shake` | `amount` (0,3): trauma da câmera, 0..1 |
| `speedlines` | `frames` (20), `intensity` (0,7), `focus` (true = radiais no ponto) |
| `slowmo` | `scale` (0,3), `frames` (40): câmera lenta (a câmera segue em tempo real) |
| `hitstop` | `frames` (6), `shake` (4): congela atacante e alvo |
| `impact_small`, `impact_big` | presets: estrela + flash + tremida (o grande com anel e linhas radiais) |

Tipo desconhecido (ex.: `aura`) não desenha nada: só sai como evento `fx`, para o app tratar.

**Easings** (`ease`): `linear`, `step`, `sineIn/Out/InOut`, `quadIn/Out/InOut`, `cubicIn/Out/InOut`,
`power2In/Out`, `expoIn/Out`, `backIn/Out/InOut`, `elastic`, `bounceOut`.
**Clipes** (`<assets>/clips/`, copiados pelo `sf init`): `idle_fly`, `dash_forward`, `dash_back`, `brake`, `look_back`, `hurt_light`,
`hurt_heavy`, `knockback_spin`, `recover`, `splat`, `fall`. Eles animam os ossos do corpo, então servem a
qualquer personagem.

---

## Guia "novo personagem"

O caminho é: **manifesto → prompts de imagem → `pose:add` → escala e esqueleto no Pose Lab → conferência pela
tira**. Exemplo com o id `rival` na coleção `minha`. Os comandos rodam na raiz do projeto (o app, depois do
`npx sf init`, ou este repositório). `<assets>` é a pasta de assets: a do `sf.config.json` (ex.: `public/sf`) ou
`assets/`.

**1. Escreva o manifesto** `<assets>/skins/rival.json`. É dele que saem os prompts de imagem. Comece pela pose
base (sem imagem ainda) e declare as outras como **provisórias**, todas a partir da base. Elas já funcionam
em cenas, com a imagem da base.

```json
{
  "default": "fly",
  "dir": "poses/minha/rival",
  "character": {
    "name": "Rival",
    "description": "homem de pele azul-ciano, cabelo preto espetado, óculos escuros, terno preto, gravata verde-azulada longa",
    "style": "anime detalhado de jogo de luta 2D, contorno escuro fino, sombreamento em cel com duas tonalidades",
    "styleRefs": ["poses/minha/rival/src/ref.png"]
  },
  "poses": [
    { "name": "fly", "description": "voando na horizontal, de bruços, braços colados para trás", "tags": ["voo", "base"] }
  ],
  "provisional": {
    "punch": { "from": "fly", "rotate": -8, "description": "soco reto com o punho da frente estendido", "tags": ["soco", "ataque"] },
    "hurt": { "from": "fly", "rotate": 20, "description": "jogado para trás depois de levar um golpe", "tags": ["dor", "reação"] }
  }
}
```

- `styleRefs`: imagens que você vai anexar na IA de imagem (uma arte de referência do personagem em
  `src/ref.png`, por exemplo). Depois da primeira pose, a própria `src/fly.png` é a melhor referência.
- Poses que vale ter: voo (`fly`, a base), tiro, esborrachado, caindo, soco, chute, levando golpe, dash.

**2. Gere as imagens.** `npx sf pose:list --char rival` imprime, para a pose base (sem imagem) e para cada
provisória, o **prompt pronto**, as imagens para anexar e os comandos seguintes. As regras fixas já vão no
prompt: mesmo personagem, corpo inteiro, **de perfil virado para a direita**, fundo branco liso. Gere a base
primeiro e use-a como referência das outras. Salve cada imagem em `<assets>/poses/minha/rival/src/<pose>.png` (num app,
pode ser uma pasta fora de `public/`, ex.: `art/rival/`: o `--src` aceita qualquer caminho).

**3. Traga a pose base:**

```bash
npx sf pose:add --char rival --pose fly --src <assets>/poses/minha/rival/src/fly.png
```

Ele recorta a figura (fundo branco e vãos fechados fora), grava `fly.webp` (lado maior ≤ 1024 px, aviso acima
de 200 KB) e `fly@2x.webp` se a fonte tiver resolução para isso, e cria `fly.skin.json` com um esqueleto inicial,
redimensionado para a figura e com a cabeça de 180 px no mundo:

- **sem `--skeleton`**: o esqueleto-modelo `humanoide` que vem no CLI. São os 16 ossos do corpo, de uma figura
  voando de bruços, sem ossos de tecido;
- **`--skeleton <id>`**: o da pose base de outro personagem do projeto, com os ossos de tecido dele. Prefira
  quem tem a mesma roupa (no repositório: sobretudo → `neo`, terno com gravata → `smith`).

Se o manifesto ainda não existir, passe `--dir poses/minha/rival` e ele é criado.

**4. Ajuste no Pose Lab.** `npx sf lab` (no repositório também serve `npm run dev`) e abra
`http://localhost:5180/?scene=poselab&mode=image&char=rival&pose=fly` (a página inicial do lab lista os
personagens e as cenas):

- arraste as **bolinhas** (articulações) até as juntas do desenho: quadril, ombro, cotovelo, punho, joelho,
  tornozelo, pescoço, topo da cabeça. Ao soltar, a malha e os pesos são refeitos. Clique num osso para ver o
  peso dele em calor (o que ele move);
- arraste os dois **quadrados amarelos** até o topo do cabelo e o queixo. É a medida da cabeça: a escala
  acompanha (a cabeça no mundo não muda de tamanho);
- **Salvar esqueleto** grava o `fly.skin.json`. Shift + arrastar move a vista; a roda dá zoom.

Os ossos de tecido (laranja) só existem se vieram do personagem copiado (`--skeleton <id>`). Se o seu não tem
gravata ou aba, apague esses ossos e a `chain` deles no `skin.json` (à mão). Para ter tecido partindo do
modelo, acrescente os ossos e a `chain` à mão (formato em [esqueleto da pose](#esqueleto-da-pose-skinjson)).
Faça isso **antes** de trazer as outras poses, que copiam o esqueleto da base.

**5. Traga as outras poses** (o `--skeleton` não é mais preciso: elas copiam o esqueleto da `fly`):

```bash
npx sf pose:add --char rival --pose punch --src <assets>/poses/minha/rival/src/punch.png
npx sf pose:add --char rival --pose hurt  --src <assets>/poses/minha/rival/src/hurt.png
```

A pose sai de `provisional` e vira pose com imagem. O esqueleto inicial é o da base, só redimensionado: num
soco, os braços e pernas estão em outro lugar. **Ajuste cada pose no Pose Lab** (passo 4). Ali a base aparece
como fantasma ao lado, e as duas linhas amarelas (altura da cabeça) precisam ficar do mesmo tamanho.

**6. Confira pela tira**: `?scene=skin&char=rival&mode=strip` mostra todas as poses lado a lado, na mesma
escala, com a linha da cabeça. Procure cabeça de tamanho diferente entre poses (corrija a medida no Pose Lab)
e rasgos ou dobras (articulação fora do lugar). `?scene=skin&char=rival&pose=punch&mode=debug` mostra malha e
ossos de uma pose; `&mode=anim` toca o `idle_fly` nela.

**7. Golpes e cena.** Crie `<assets>/moves/rival.moves.json` ([novo golpe](#guia-novo-golpe)) e ponha o
personagem num roteiro ([nova cena](#guia-nova-cena)). Sem arquivo de golpes, o personagem entra em cena
normalmente, só sem golpes.

> A folha de peças (`parts`) é opcional e fica no [apêndice](#apêndice-rig-de-peças-opcional).

---

## Guia "nova pose"

1. **Descreva no manifesto.** Ponha a pose em `provisional` (`from`: a pose existente mais parecida; `rotate`,
   `sx`, `sy`, `dx`, `dy` deixam a provisória mais próxima). Ela já funciona em golpes e cenas.
2. **Prompt:** `npx sf pose:list --char <id> --provisional`. Gere a imagem e salve em `<dir>/src/<pose>.png`.
3. **Recorte:** `npx sf pose:add --char <id> --pose <pose> --src <png> [--description "…" --tags a,b]`.
   Use `--rect x,y,w,h` se a imagem tiver mais de uma figura; `--replace` troca a imagem de uma pose que já
   existe (o `skin.json` fica: confira o esqueleto depois).
4. **Escala:** no Pose Lab (`?scene=poselab&mode=image&char=<id>&pose=<pose>`), os quadrados amarelos no topo do
   cabelo e no queixo; as linhas amarelas da pose e do fantasma da base ficam iguais. O slider "Escala da pose"
   muda só a escala (para ajuste fino a olho). `npx sf normalize --char <id>` recalcula a escala de
   todas as poses pela medida salva (a base é a referência).
5. **Esqueleto:** arraste as articulações até o desenho e salve.
6. **Membros sobrepostos:** quando a perna (ou o braço) de trás fica escondida atrás da da frente, dê
   `"follow": "<osso da frente>"` ao osso de trás no `skin.json`: ele copia a rotação e a imagem não estica.
7. **Transições:** numa cena, troque para a pose e volte (`pose` sem `transition`): na ida sai o borrão
   (`smear`), na volta à base o rastro (`afterimage`). Pulo de posição ou de tamanho na troca indica medida da
   cabeça ou quadril fora do lugar. `node apps/demo/shots/seq.mjs` mostra a troca quadro a quadro (ver
   [ferramentas](#ferramentas)).

## Guia "nova variante"

Uma variante é a **mesma pose com outra imagem**: outra expressão do rosto ou outra mão (vazia, segurando
algo). Ela reusa o esqueleto, a malha e os pesos da pose, então a figura **não pode mudar de lugar nem de
tamanho**.

1. **Imagem:** edite a imagem da pose (`<dir>/src/<pose>.png`) mudando só o rosto ou a mão, no mesmo tamanho
   de tela. O `narrate missing` gera o prompt certo para isso (`variantPrompt`).
2. **Registrar:**

   ```bash
   npx sf pose:add --char <id> --pose shoot --variant nogun --kind hand --src <png> --description "mão vazia" --tags mão
   ```

   `--kind expression` para rosto, `hand` para mão. A fonte é recortada **com a caixa da figura da pose base**.
   Ele confere a silhueta contra a base e avisa acima de 3 % de diferença (desalinhada). Os nomes `2x` e
   `none` são reservados.
3. **Conferir:** `?scene=variants&char=<id>` mostra a base, a variante desenhada com a malha da base e as
   silhuetas sobrepostas, com a %.
4. **No roteiro:** `{ "actor": "<id>", "do": "hand", "params": { "name": "nogun" } }` (ou `"expression"`).
   A escolha vale para a pose atual e para as próximas que tiverem a variante; `"none"` volta à imagem da
   pose. Pose sem a variante fica como está e sai um aviso (no HUD da demo e no `validate`).

---

## Guia "novo golpe"

1. **Poses.** Escolha as poses do golpe no catálogo (`npx sf catalog`) ou crie (provisória
   primeiro, [nova pose](#guia-nova-pose)). A pose de reação do alvo (`onHit.targetPose`) é do **alvo**.
2. **Fases.** Escreva o golpe em `<assets>/moves/<id>.moves.json` (formato em [golpe](#golpe-movesidmovesjson)).
   O ritmo de luta é antecipação curta → fase ativa curta → recuperação:
   - `preparo` (3–6 frames) com `pose` e, se avança, `motion.dash`;
   - `ativo` (4–6 frames) com `hitboxes` no osso que bate (`hand_front`, `foot_front`), `along` cobrindo a
     ponta;
   - `recuperar` e `voltar` (8–10 frames) com `"pose": "fly"` (sai o rastro).
3. **Teste numa cena** curta (`move` com `target`):

   ```json
   { "cast": { "rival": { "at": [220, 600], "scale": 0.4, "clip": "idle_fly" },
               "smith": { "at": [420, 600], "scale": 0.4, "facing": -1, "clip": "idle_fly" } },
     "steps": [ { "at": 0.3, "actor": "rival", "do": "move", "params": { "id": "jab", "target": "smith" } } ] }
   ```

4. **Hitboxes no debug.** `npx sf validate scenes/<cena>.json` conta os contatos
   (`hit:rival->smith ×1`). Para ver: `?scene=script&file=scenes/<cena>.json&debug=1&at=hit:1%2B0` congela no
   quadro do 1º contato (`hit:1-3` = 3 frames antes) com ossos, **hurtboxes azuis** (corpo do alvo),
   **hitbox vermelha** (só na fase ativa) e a etiqueta golpe · fase · frame. Sem contato, aumente `radius`,
   ajuste `along`, aproxime os personagens ou dê mais `dash` no preparo. Hitbox longe do punho ou do pé
   significa que o osso está fora do lugar naquela pose: ajuste o esqueleto dela no Pose Lab (a hitbox segue o
   osso). `npx sf preview
   scenes/<cena>.json --debug` faz a folha de contato com o debug.
5. **Impacto:** `onHit` com `hitstop` (4–9), `knockback`, `targetPose`/`targetClip` e `fx`
   (`impact_small`/`impact_big`); efeitos de fase (`afterimage` no avanço, `speedlines`, `camera.shake`).
6. **Comportamento novo** que os dados não cobrem (teleporte, invocar algo): uma ação TS, registrada uma vez
   no app, antes de carregar a cena, e chamada pelo nome no `run` de uma fase, com parâmetros se precisar:

   ```ts
   import { registerAction } from '@perolanegra/sprite-fighter';

   registerAction('teleport_front', ({ self, target, fx, params }) => {
     if (!target) return;
     const distance = typeof params['distance'] === 'number' ? params['distance'] : 120;
     fx.afterimage(self, { life: 14 });
     const t = target.actor;
     self.actor.position = { x: t.position.x + distance * t.facing * t.scale, y: t.position.y };
     self.actor.face(t);
   });
   ```

   ```json
   { "name": "sumir", "frames": 6, "run": { "action": "teleport_front", "params": { "distance": 140 } } }
   ```

   O contexto traz `self`, `target`, `params` (os da fase; vazio com `"run": "<nome>"`), `fx` (smear,
   afterimage, flash, impact, spark, speedLines, emit, run), `camera` (shake, zoom, pan, follow, auto),
   `scene` (o World) e `rng` (determinístico: nunca use `Math.random`). Embutidas: `teleport_behind`,
   `vanish`, `appear`.
7. **Declare a ação para as ferramentas** em `sf.actions.json`, na raiz do projeto que usa a lib. O código do
   app não roda no `narrate validate`/`preview` nem no `/narrate`; o arquivo diz quais ações existem e que
   parâmetros aceitam:

   ```json
   [
     { "name": "teleport_front", "description": "some e reaparece na frente do alvo",
       "params": { "distance": "distância do alvo, em px (padrão 120)" } }
   ]
   ```

   - **Com o arquivo**, ele é a lista completa: ação que não é embutida nem está nele, ou parâmetro que ela
     não declara, é **erro** no `validate`.
   - **Sem o arquivo**, ação desconhecida é só **aviso**.
   - Em ambos os casos a simulação seca e a prévia usam uma ação vazia no lugar (a prévia avisa no HUD): o
     efeito da ação não aparece nelas, só no app.
   - O catálogo (`npx sf catalog`, campo `actions`) lista as embutidas e as declaradas, com
     descrição e parâmetros; é por ele que o `/narrate` sabe que elas existem.

---

## Guia "nova cena"

### À mão

1. Veja o que existe: `npx sf catalog` (personagens, poses com descrição e variantes,
   provisórias, golpes, clipes, efeitos, props, comandos e eventos).
2. Escreva `<assets>/scenes/<nome>.json` ([formato](#roteiro-scenesnomejson)). Use a perseguição do repositório
   (`assets/scenes/chase.json`) como modelo: rota com `moveTo`, tiro com `move`, esquiva com `on: incoming:…`, porta com `spawnProp` →
   `enter` → `prop close`, e a batida com `on: hit:door->…`.
3. `npx sf validate scenes/<nome>.json` até dar `OK`: formato, nomes, simulação seca (duração,
   `on` que nunca dispara, ator fora do quadro, cena sem fim) e avisos.
4. Veja: `npx sf lab` → `?scene=script&file=scenes/<nome>.json` (barra de tempo para `seek`, câmera lenta e
   laço; `&debug=1` mostra poses e PROVISÓRIA), ou `npx sf preview scenes/<nome>.json`.

### Pelo `/narrate`

No Claude Code, dentro do repositório: `/narrate o agente persegue o neo pelos telhados, atira duas vezes, o
neo desvia e some numa porta; o agente bate de cara e cai`. O Claude Code lê o catálogo, escreve a cena e um
**arquivo lateral** `scenes/<nome>.narrative.json` (a narrativa, o `poseMap` ação → pose com
`exact`/`similar`/`provisional`/`missing`, o que falta, os eventos esperados e as suposições), valida, roda a
prévia, confere as imagens e corrige até a cena contar a narrativa. Nenhuma API paga: as ferramentas são só
determinísticas (`.claude/commands/narrate.md` descreve o passo a passo).

### O ciclo das poses que faltam

Uma cena pode pedir uma pose que ainda não tem imagem (ex.: um chute giratório):

1. Na cena, use o nome novo (`kick_spin`). No arquivo lateral, declare em `missing`
   (`{ "kind": "pose", "char", "name", "description", "tags", "closest": "kick", "why" }`).
2. `npx sf validate …` acusa a pose pendente.
3. `npx sf missing scenes/<nome>.json` grava a **provisória** no manifesto (`kick_spin ← kick`) e
   gera `scenes/<nome>.missing.md` com o prompt de imagem e o `pose:add` de cada pose, variante ou golpe que
   falta. `--no-provisional` só gera o `.md`.
4. A cena já roda com a provisória (debug: "PROVISÓRIA ← kick"). `npx sf pose:list --char <id>
   --provisional` mostra o que ainda é provisório.
5. Quando a imagem chega: o `pose:add` do `.missing.md`, ajuste no Pose Lab, e a mesma cena roda com a pose
   de verdade, sem mudar o roteiro.

### Prévia

`npx sf preview scenes/<nome>.json [--times 0.5,1.2] [--debug]` acha os tempos-chave pela
simulação seca (início, contatos, trocas de pose, fim), tira os screenshots pela demo e monta
`.sf/preview/<nome>/contato.png`, com o que acontece em cada quadro.

---

## Ferramentas

O CLI é o `sf` (`@perolanegra/sprite-fighter-cli`); `npx sf help` lista tudo. Ele trabalha na pasta de assets do
projeto: `--assets <pasta>`, a variável `SF_ASSETS`, o campo `assets` do `sf.config.json` ou, por padrão, `assets/`.

| Comando | O que faz |
|---|---|
| `npx sf init [--assets <pasta>] [--force]` | prepara o projeto: pasta de assets com os clipes, `sf.config.json`, `sf.actions.json` de exemplo e `.claude/commands/narrate.md` (não sobrescreve sem `--force`) |
| `npx sf lab [--port 5180]` | o lab no navegador: página inicial com personagens e cenas, Pose Lab, tira de poses, cenas com debug; "Salvar esqueleto" grava nos assets do projeto |
| `npx sf catalog` | tudo o que um roteiro pode usar, em JSON |
| `npx sf validate <cena>` | formato, nomes, simulação seca, eventos esperados e avisos; saída ≠ 0 com erro (`--json`) |
| `npx sf missing <cena>` | provisórias no manifesto + `<cena>.missing.md` com prompts e comandos (`--no-provisional`) |
| `npx sf preview <cena>` | screenshots nos tempos-chave + folha de contato em `.sf/preview/<cena>/` (`--times`, `--debug`). Precisa do Playwright: `npm i -D playwright && npx playwright install chromium` |
| `npx sf pose:add --char <id> --pose <p> --src <png>` | recorta, converte (WebP 1x/@2x), cria o esqueleto inicial, registra e normaliza a escala. Primeira pose: esqueleto-modelo `humanoide` (ou `--skeleton <outro-id>`); `--rect`, `--description`, `--tags`, `--replace`, `--dir` |
| `npx sf pose:add … --variant <v> --kind expression\|hand` | variante de textura (mesmo enquadramento da pose) |
| `npx sf pose:list --char <id> [--provisional]` | poses, situação, arquivos e escala; prompts das provisórias e das poses sem imagem |
| `npx sf normalize --char <id>` | recalcula a escala de todas as poses pela medida da cabeça (base = referência) |
| `npx sf pose <png> --char <id> --pose <p> [--rect]` | só o recorte e o registro (o `pose:add` chama este e normaliza) |
| `npx sf sheet <folha.png> --char <id>` | recorta uma folha de peças em atlas ([apêndice](#apêndice-rig-de-peças-opcional)) |
| **Só no repositório:** | |
| `npm run shots -- "scene=chase&t=1.2" …` | screenshots da demo (sobe o Vite sozinho); sem argumentos, os de `apps/demo/shots/shots.json`. Saída em `apps/demo/shots/out/` |
| `node apps/demo/shots/seq.mjs [nome…]` | sequências quadro a quadro em folhas de contato (`seq.json`: `{ name, query, at: "pose:<id>:1" \| "hit:2", from, to }`) → `shots/out/seq/` |
| `node apps/demo/shots/perf.mjs` | custo por quadro (simulação + desenho) e fps das cenas ao vivo, WebGL e Canvas 2D. `GPU=1`: navegador com janela e GPU real |
| `node apps/demo/shots/profile.mjs [cena] [s]` | perfil de CPU e timeline por thread (o mesmo do DevTools → Performance) → `shots/out/profile/` |
| `npm run ng:start` / `npm run ng:check` | app Angular de exemplo / conferência de vazamentos, zona, DPR e screenshots |
| `npm run size` | tamanho do player (minificado e gzip) contra o orçamento, e quanto a autoria acrescenta; saída ≠ 0 acima do orçamento |
| `npm run pack:all` | os 3 pacotes em `dist/packs/*.tgz` (ver [testar com os .tgz](#testar-com-os-tgz-sem-publicar)) |

`SF_ASSETS=<pasta>` também troca a pasta de assets do `npm run dev`; serve para testar numa cópia sem mexer nos
assets reais.

---

## Demo e parâmetros

`npx sf lab` (ou, no repositório, `npm run dev`) → `http://localhost:5180/?scene=…`; sem `?scene=`, a página
inicial lista os personagens e as cenas:

| Cena | |
|---|---|
| `script&file=scenes/<x>.json` | toca um roteiro (`chase` = `scenes/chase.json`) |
| `poselab&mode=image&char=<id>&pose=<p>` | Pose Lab das poses-imagem (esqueleto, medida da cabeça, escala) |
| `skin&char=<id>&mode=strip\|debug\|anim\|rest&pose=<p>` | poses: tira, malha e ossos, animação |
| `variants&char=<id>` | conferência das variantes |
| `combo` | combo de socos com câmera lenta (personagens da demo) |
| `anim&char=<id>&clip=<c>` | um clipe dentro de um movimento curto |
| `rig`, `poselab&char=<id>` | rig de peças (só quem tem atlas + rig) |

Parâmetros das cenas: `&t=1.6` (seek), `&from=3.2&t=1.6`, `&play=1.6` (avança quadro a quadro, sem seek),
`&at=hit:N±F` / `&at=pose:<id>:N±F` (o N-ésimo contato ou troca de pose ± F frames; na URL o `+` é `%2B`),
`&debug=1`, `&gl=0` (Canvas 2D), `&perf=1`.

---

## Orçamento e medições

| Item | Meta | Medido |
|---|---|---|
| player (`sprite-fighter`, gzip) | **≤ 54,5 KB** (o medido + 10 % de margem) | **49,7 KB** (162 KB minificado); 48,0 KB no uso típico (`Scene` + `Character` + parsers) · `npm run size` (2026-11-17) |
| `@perolanegra/sprite-fighter/authoring` | fora do bundle do player | +4,8 KB gzip para quem importa (no Angular, um chunk preguiçoso de 1,3 KB carregado pelo `debug`) |
| pose WebP 1x | ≤ 200 KB, lado ≤ 1024 px | 48–99 KB nas 15 poses 1x (o `pose:add` avisa acima de 200 KB) |
| @2x | só com DPR > 1,5 | carregada só com DPR > 1,5 |
| 60 fps, 2 personagens + efeitos | WebGL e Canvas 2D | GPU real (WSLg): custo do nosso código 0,9–1,3 ms/quadro (WebGL) e 1,8–2,7 ms (2D), 55–60 fps; ver limites |

**As imagens das poses são o peso dominante, não o código.** A perseguição baixa 7 poses: ~480 KB de WebP 1x,
quase 10 vezes os 49,5 KB do player. A biblioteca inteira tem ~1,1 MB em 1x (neo 446 KB em 6 poses, smith 638
KB em 9) e ~1,0 MB em @2x, esta só para telas densas. Cada pose nova pesa 50–100 KB; cortar o código rende
pouco perto disso. O que mais reduz o download é carregar só as poses que a cena usa (o player já faz isso: as
do roteiro e as dos golpes do elenco) e manter o 1x ≤ 200 KB.

O orçamento antigo (< 40 KB) foi trocado pelo medido + 10 % depois de separar a entrada de autoria (o player
caiu de 53,9 para 49,5 KB). Chegar a 40 KB pediria mudar a arquitetura (gravar malha e pesos no `skin.json`,
separar o rig de peças), e não foi feito.

---

## Limites conhecidos

- **Amplitude da deformação.** Cada pose é uma imagem que dobra pouco: os ossos giram no máximo ±12° (membros)
  e ±25° (tecido) a partir do desenho, e o `scale` da raiz estica pouco. Movimento grande (um giro, um chute
  em outro ângulo) pede **outra pose**, não mais deformação. Por isso o fluxo é "biblioteca de poses" e não "um
  boneco que faz tudo".
- **Poses sempre de perfil, viradas para a direita.** Olhar para a esquerda é espelhar (`facing: -1`, `face`).
  Não há vista de frente, de costas nem três quartos; uma imagem assim entra como pose, mas o personagem
  espelhado continua sendo o mesmo desenho invertido (cicatriz, mão dominante e texto trocam de lado).
- **Mesmos ossos em todas as poses** de um personagem. Os de tecido vêm do personagem copiado no
  `--skeleton` e só se removem editando o `skin.json` à mão.
- **Variantes** precisam do mesmo enquadramento da pose (aviso acima de 3 % de silhueta diferente).
- **WSL/WSLg.** No headless do WSL só há GPU por software (SwiftShader): o WebGL fica em 35–58 fps por limite
  da GPU emulada, não do código. Com a GPU real via WSLg, o processo da GPU gasta ~10 ms por quadro só para
  apresentar a imagem (um quadro vazio já custa 11 ms), o que dá ~49–60 fps. O nosso JS custa ~1 ms por
  quadro. Falta medir num navegador nativo do Windows; se o custo de apresentar continuar alto, o caminho é
  reduzir as três camadas de tela cheia (fundo 2D, WebGL, frente 2D).
- **Desempenho.** A malha e os pesos de cada pose são montados na carga (~100–200 ms por pose); as poses do
  roteiro e dos golpes são carregadas antes do `ready`. Trocar de DPR cruzando 1,5 com a cena aberta não
  troca as texturas (1x ↔ @2x).
- **Ações TS do app** não rodam no `narrate validate`/`preview`: elas são conferidas pelo `sf.actions.json`
  (nome e parâmetros), mas a simulação seca e a prévia usam uma ação vazia no lugar. Um contato que dependa do
  que a ação faz (ex.: um teleporte que põe o atacante ao alcance) não aparece na validação.
- **Nome errado no player** falha só quando é usado (carga da pose, início do golpe, clipe, prop). A
  conferência de tudo de uma vez, com as listas do que existe, é `checkScene` (autoria) ou o `narrate validate`.
- **Angular 21 só.** O `@perolanegra/ngx-sprite-fighter` é compilado com Angular 21 e pede `^21` (o 22 não
  satisfaz o peer). O player e o CLI não dependem do Angular.
- **Variante e imagem-fonte.** O `pose:add --variant` recorta a variante com a caixa da figura da pose base,
  refeita a partir de `<dir>/src/<pose>.png`. Sem essa fonte na pasta de assets, ele só aceita a variante já no
  tamanho final da pose.
- `parts` (rig de peças) não tem hurtbox, e um personagem só com poses não tem a skin `parts`.

---

## Apêndice: rig de peças (opcional)

O modo original monta o personagem a partir de uma **folha de peças** (cabeça, tronco, braços, pernas
separados, fundo branco). Ele dobra mais que uma pose-imagem, mas tem a cara de boneco recortado. Os dois
personagens da demo têm os dois modos; um personagem novo não precisa dele.

1. `npx sf sheet assets/sheets/<id>-sheet-parts.png --char <id>` gera `assets/atlas/<id>.atlas.png/.json`,
   a prévia numerada `preview-<id>.png` e `names/<id>.json` com `part_<n>`.
2. Dê nomes às peças em `assets/atlas/names/<id>.json` olhando a prévia (convenção no `CLAUDE.md`: `torso`,
   `upper_arm_1`, `hand_fist`, `head_<expr>`…) e rode de novo.
3. Escreva `assets/rigs/<id>.rig.json` (ossos com `part`, `parent`, `pivot`, `attach`, `angle|rotate`,
   `layer`, `stretch`; `caps`; `chains` de tecido) e ajuste no Pose Lab de peças (`?scene=poselab&char=<id>`,
   com a folha de referência como fantasma; "Exportar rig").
4. Carregue com `Character.load({ atlas, rig, poses })`. Troca de modo: `character.setSkin('parts' | 'image')`
   ou o parâmetro `skin` do comando `pose`.

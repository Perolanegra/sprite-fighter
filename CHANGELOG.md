# Changelog

Mudanças de API dos três pacotes, que andam com a mesma versão
([semver](https://semver.org/lang/pt-BR/); antes da 1.0, uma versão menor, 0.x → 0.y, pode quebrar a API):

- `@perolanegra/sprite-fighter`: o player e a entrada `/authoring`;
- `@perolanegra/ngx-sprite-fighter`: o componente Angular;
- `@perolanegra/sprite-fighter-cli`: o CLI `sf`.

Cada versão é publicada no GitHub Packages pela tag `v<versão>` (ver README, "Publicar").

## [0.2.0] - 2026-11-17

Recurso novo: personagens que interagem com objetos pela **âncora do prop**, não por coordenada fixa (antes, um
roteiro que punha o personagem e a porta em coordenadas fixas errava a porta).

### @perolanegra/sprite-fighter

- **Âncoras de prop:** todo prop expõe pontos nomeados calculados da caixa atual (acompanham posição e tamanho):
  `center`, `top`, `bottom`, `left`, `right`. A porta acrescenta `opening` e `front`; `top`/`bottom` são as pontas
  da passagem.
  - `registerProp` aceita `anchors: { <nome>: (prop) => Vec2 }` e `opening: (prop) => { box, axis: 'x' | 'y' }`
    (a passagem, para `enter`/`exit`);
  - funções novas: `propAnchor`, `propOpening`, `anchorNames`, `BOX_ANCHORS`;
  - `spawnProp` ganhou `facing` (lado da frente, onde fica a âncora `front`; padrão −1 = esquerda). `Prop.facing` é
    opcional.
- **`moveTo`:**
  - `to` aceita `{ "prop", "anchor", "offset"? }`, resolvido a cada passo (acompanha o prop);
  - `align: "root" | "center"`: `center` leva ao destino o centro visual (centro da caixa da silhueta da pose) em
    vez do quadril. `relative` só com `to: [x, y]`, e `align` só com `to`.
  - `MoveTo` (TS) aceita `to` como função (destino relido a cada passo).
- **`enter` reescrito:** o centro visual vai até a abertura (`opening`), de onde o ator estiver. A flutuação some
  perto da passagem; o ator encolhe (`shrink`; padrão até 0,7, menos se precisar para caber no vão) e é recortado
  pelo plano da abertura. O recorte acompanha o prop.
- **`exit` novo** (`{ prop, duration, ease?, to?, offset?, scaleTo?, shrink? }`): surge pequeno e recortado na
  passagem e vai até a âncora (padrão `front`), crescendo até a escala de antes do `enter`. No fim, restaura o
  `collideProps`.
- **`Actor`:**
  - `visualOffset()` e `visualCenter()`: o centro da silhueta da pose em repouso, sem flutuação nem tecido;
  - `hoverWeight` (0..1): quanto da flutuação vale.
- **`Director`:**
  - `passChecks`: em cada `enter`/`exit` (ao cruzar o plano) e em cada contato com prop que tem abertura, o centro
    visual e quanto ele fica fora do vão;
  - `entered`: escala e `collideProps` de quem entrou.
- **Funções puras da passagem:** `passPlan`, `sideDistance`, `planePoint`, `hiddenQuad`, `spanMiss`, `fitScale`,
  `hoverNear`.
- **Autoria (`/authoring`):**
  - `passCheckErrors(checks)` diz o deslocamento em px e para que lado mover (`PASS_TOLERANCE` = 2 px);
  - `checkScript` confere a âncora citada (`moveTo`, `exit.to`) e se o prop do `enter`/`exit` tem abertura;
  - `ScriptCatalog.props` ganhou `anchors` e `opening`; a API fluente ganhou `exit(...)`, o `moveTo` com âncora e
    `align`, e o `facing` do `spawnProp`; o tipo `AnchorJson` é exportado;
  - JSON Schema: o `to` do `moveTo` é `[x, y]` ou o objeto de âncora.
- `VERSION` = `'0.2.0'`.

### @perolanegra/sprite-fighter-cli

- `sf validate`: na simulação seca, acusa como **erro** o centro visual fora da abertura num `enter`/`exit` ou num
  contato com prop, com o deslocamento em px.
- `sf catalog`: `props.<tipo>` lista `anchors` e `opening`.
- `sf preview`: tempo-chave também depois de `exit`.
- `/narrate` (o `narrate.md` do `sf init`): usar âncoras e `enter`/`exit` sempre que a narrativa envolve um objeto.
  Coordenadas fixas ficam só para posições livres no céu.

### @perolanegra/ngx-sprite-fighter

- Sem mudanças de API: só a versão. O peer passa a `@perolanegra/sprite-fighter` `^0.2.0`.

## [0.1.1] - 2026-11-17

### @perolanegra/sprite-fighter-cli

- **Prompts de imagem** (`sf pose:list`, `sf missing`): quando a imagem-fonte de uma pose (`<dir>/src/<pose>.png`) não existe, a referência passa a ser a `.webp` da pose, sem o aviso "NÃO ENCONTRADO". Acontece, por exemplo, num app que importou só as poses prontas. Vale para:
  - a pose de partida das provisórias;
  - os `styleRefs` que apontam para a fonte de uma pose (sem repetir a mesma imagem);
  - a imagem-base das variantes (o "mesmo tamanho de" passa a citar a `.webp`).
- `imagePrompt` e `variantPrompt` ganharam um último parâmetro opcional, `exists(rel)`. Sem ele, o comportamento é o da 0.1.0 (sempre a fonte); a função nova `poseRef` escolhe entre a fonte e a `.webp`.

### @perolanegra/sprite-fighter e @perolanegra/ngx-sprite-fighter

- Sem mudanças de API: só a versão (os três pacotes andam juntos). O peer do componente e a dependência do CLI passam a `^0.1.1`.

## [0.1.0] - 2026-11-17

Primeira versão distribuída.

### @perolanegra/sprite-fighter

- Duas entradas:
  - `@perolanegra/sprite-fighter` é o **player**, sem dependências: `Scene`, `Character`, `Director`, `World`, `Actor`, `CanvasRenderer`, parsers (`parseManifest`, `parseSkin`, `parseMoves`, `parseClip`, `parseScript`), `registerAction`, `registerProp`, `COMMANDS`, `EVENTS`.
  - `@perolanegra/sprite-fighter/authoring` é a **autoria**: `checkScene`/`checkScript`, `scriptSchema`, `COMMAND_DOCS`, a API fluente `script(…)`, `drawFightDebug`, `drawSkinDebug` e `Reader`.
- `Scene.create(…, { debug })` recebe a função de desenho (`DebugDraw`, ex.: `drawFightDebug`), não mais um booleano; `scene.debug` muda ao vivo.
- `Director.create` não faz mais a conferência detalhada dos nomes (agora em `checkScene`). Um nome errado falha com mensagem clara no ponto de uso: pose, golpe, clipe, tipo e ação de prop.
- Golpes: `run` aceita `"<ação>"` ou `{ "action": "<ação>", "params": { … } }`; os parâmetros chegam em `ActionContext.params`.
- `Character.fromPoses(manifesto, carregadores)` monta um personagem só com poses-imagem, também em Node; o tipo `PoseLoaders` é exportado.
- O primeiro quadro de toda cena (início, `seek`, recomeço) já sai enquadrado e com os atores no lugar (`Actor.settle`, `World.frameCamera`, `CameraRig.frame`).
- `VERSION` = `'0.1.0'`.
- Orçamento do bundle: player ≤ 54,5 KB gzip (49,5 KB medido ao fixar o orçamento; 49,7 KB nesta versão).

### @perolanegra/ngx-sprite-fighter

- Compilado com Angular 21 (ng-packagr 21); peers: `@angular/core` e `@angular/common` `^21.0.0`, `@perolanegra/sprite-fighter` `^0.1.0`.
- `<sf-scene>`: o input `debug` baixa o desenho de debug (`@perolanegra/sprite-fighter/authoring`) só quando liga (import dinâmico).

### @perolanegra/sprite-fighter-cli

- **Bin:** `sf`. Junta as ferramentas que antes eram `tools/atlas` e `tools/narrator`: `pose:add`, `pose:list`, `normalize`, `pose`, `sheet`, `catalog`, `validate`, `missing` e `preview`.
- **`sf init [--assets <pasta>]`:**
  - cria a pasta de assets (skins, poses, moves, scenes e os clipes genéricos em `clips/`);
  - grava `sf.config.json`, um `sf.actions.json` de exemplo e `.claude/commands/narrate.md`.
- **`sf lab`:** a demo compilada (Pose Lab, tira de poses, cenas) servindo os assets do projeto.
- **Pasta de assets**, nesta ordem: `--assets`, `SF_ASSETS`, `sf.config.json` e, por padrão, `assets/`.
- **`pose:add`:** a primeira pose de um personagem, sem `--skeleton`, parte do esqueleto-modelo `humanoide`, que vem no pacote.
- **`preview`:** usa o lab (sem Vite) e grava em `.sf/preview/<cena>/`. O Playwright é um peer opcional.
- **`sf.actions.json`:** ações TS do app declaradas para o `validate`, o `catalog` e o `/narrate`.

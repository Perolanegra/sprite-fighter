# Changelog

Mudanças de API dos três pacotes, que andam com a mesma versão
([semver](https://semver.org/lang/pt-BR/); antes da 1.0, uma versão menor, 0.x → 0.y, pode quebrar a API):

- `@perolanegra/sprite-fighter`: o player e a entrada `/authoring`;
- `@perolanegra/ngx-sprite-fighter`: o componente Angular;
- `@perolanegra/sprite-fighter-cli`: o CLI `sf`.

Cada versão é publicada no GitHub Packages pela tag `v<versão>` (ver README, "Publicar").

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

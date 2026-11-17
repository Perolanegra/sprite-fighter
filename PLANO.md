# Plano — sprite-fighter

Lib TypeScript: folha de peças PNG → personagem articulado → **cenas roteirizadas** com linguagem de
luta DBZ 2D (fluida, com impacto), integrada ao Angular. Não é um jogo: não há controle do usuário.

## Como usar este plano no Claude Code

1. Crie a pasta do projeto e coloque nela:
   - `CLAUDE.md` e `PLANO.md` (estes arquivos) na raiz
   - `assets/sheets/neo-sheet-parts.png` e `assets/sheets/smith-sheet-parts.png`
   - `assets/reference/` com as folhas de personagem completas (opcional, mas ajuda)
   - `reference/montar_personagem.py` (o script de montagem que já temos)
2. `git init`, depois rode `claude` na pasta.
3. Para cada fase:
   - aperte **Shift+Tab** até entrar no **modo de planejamento** e cole o prompt da fase;
   - revise o plano que ele propuser, aprove e deixe ele executar;
   - ao terminar, rode a demo você mesmo e confira os critérios de pronto;
   - use `/clear` antes de começar a próxima fase (o `CLAUDE.md` e o `PLANO.md` guardam o contexto).
4. Se algo sair errado, descreva **o que você viu** ("o braço gira pelo meio, não pelo ombro"),
   não a solução. Ele investiga e corrige.

Decisões: **somente cenas roteirizadas** (sem teclado, gamepad ou IA). Golpes em JSON por fases;
golpes especiais customizados usam o mesmo formato + ações TS registradas (ver "Golpes customizados").

**Abordagem a partir da Fase 3.5:** o modo principal é **`image`**: cada personagem tem uma
**biblioteca de poses-chave em imagem** (`setPose`), cada uma com imagem, malha, pesos e esqueleto
próprios, mas com os **mesmos nomes de ossos**. O **rig de peças (`parts`) é opcional**: o personagem
funciona só com poses-imagem. As peças entram se existirem, por exemplo num golpe que precise de
articulação ampla.

- **Troca de pose sem pulo nem mudança de tamanho:**
  - a **âncora** é o quadril (osso raiz) da pose;
  - cada pose tem uma **escala normalizada** (a altura da cabeça, do topo do cabelo ao queixo, igual à da pose `fly`).
- **Transições padrão:** **`smear` na ida** e **`afterimage` na volta**. O `cut` só é usado quando pedido explicitamente.
- **Orçamento de imagens:** cada pose em **WebP com alfa**, lado maior até **1024 px**, meta de **≤ 200 KB por pose**. A versão **@2x** é gerada e carregada só quando a tela pede (DPR > 1,5). O CLI de atlas faz a conversão.

---

## Fase 0 — Estrutura do projeto

**Prompt:**
> Leia CLAUDE.md e PLANO.md. Execute a Fase 0: crie o monorepo com npm workspaces conforme a seção
> "Estrutura", com TypeScript strict, Vite, Vitest e Playwright configurados, e os scripts npm listados.
> Não implemente lógica ainda. No fim, rode build e test vazios e mostre a árvore criada.

**Estrutura:**
```
packages/core/        # a lib (sem deps de runtime)
packages/angular/     # ngx-sprite-fighter (Fase 7)
tools/atlas/          # CLI de recorte de folhas (usa sharp)
apps/demo/            # demo Vite + TS (playground, pose lab, cenas)
assets/, reference/
```
**Scripts:** `dev`, `build`, `test`, `shots` (Playwright tira screenshots da demo em tempos definidos
por query string, ex.: `?scene=chase&t=1.2`), `atlas` (roda o CLI).

**Pronto quando:** `npm run build` e `npm test` passam; `npm run dev -w apps/demo` abre uma página vazia.

---

## Fase 1 — Atlas: recortar as folhas

**Prompt:**
> Execute a Fase 1 do PLANO.md. Implemente o CLI de atlas, rode nas duas folhas, gere as prévias
> numeradas, ABRA as prévias, nomeie as peças segundo a convenção do CLAUDE.md e gere os atlas finais.
> Mostre as prévias e a lista de peças de cada personagem.

**Tarefas:**
1. `tools/atlas`: lê o PNG, remove o fundo branco por *flood fill a partir das bordas* (limiar de cor
   próximo do branco e baixa saturação, pra não apagar o sobretudo creme nem a camisa branca), suaviza a
   borda do alfa em ~1 px.
2. Detecta as peças por componentes conectados no alfa (ignora sujeiras < ~400 px), recorta cada uma com
   2 px de margem e empacota numa **textura atlas** (`<char>.atlas.png`) + `<char>.atlas.json`
   (`name, x, y, w, h, sourceRect`).
3. Gera `preview-<char>.png` com cada peça numerada. Os nomes ficam em `names/<char>.json`
   (`{ "12": "thigh_1", ... }`), que você (Claude) preenche olhando a prévia, e o usuário pode corrigir.
4. Peças "tile" (olhos/boca com fundo de pele quadrado) são marcadas `kind: "overlay"`.
5. Opcional: flag `--upscale 2` para ampliar com filtro Lanczos (o upscale com IA, se houver, é feito
   pelo usuário fora do projeto).

**Pronto quando:** os dois atlas existem; as prévias mostram todas as peças, sem fundo branco e sem
cortes; cada peça tem um nome válido.

---

## Fase 2 — Rig e renderização

**Prompt:**
> Execute a Fase 2 do PLANO.md. Porte a lógica de pivô/attach do reference/montar_personagem.py para TS,
> crie o formato de rig, o renderizador Canvas 2D e o Pose Lab da demo. Configure o rig dos dois
> personagens na pose de voo. Tire screenshots e analise antes de concluir.

**Tarefas:**
1. **Formato de rig** (`<char>.rig.json`): ossos com `name, parent, part, pivot, attach, angle|rotate,
   layer (back/front), order`, igual ao `pose.json` do script de referência, mais:
   - `slots`: peças trocáveis no mesmo osso (cabeças/expressões, mãos `open/relaxed/fist/gun/reach`);
   - `caps`: discos de articulação desenhados sobre o encaixe (cotovelo, joelho) pra esconder a emenda;
   - `chains`: correntes de tecido (abas do sobretudo/paletó, gravata) para a Fase 3.
2. **Pivô automático** por PCA do alfa da peça (ponta `top/bottom/left/right` recuada pra dentro) ou
   por `bbox`/`xy`, como no script de referência.
3. **Esqueleto em runtime**: transformações locais → mundo (matrizes 2D), *flip* horizontal (personagem
   virado pra esquerda), ordem de desenho por camada.
4. **Renderer Canvas 2D**: desenha as peças do atlas com `setTransform`, com suporte a tint/flash
   (Fase 5), DPR alto e redimensionamento.
5. **Pose Lab** (`apps/demo`, `?scene=poselab`): clica num osso pra selecionar, arrasta pra girar,
   mostra pivôs e hierarquia, troca slots e **exporta o JSON** da pose. É a ferramenta de autoria dos golpes.

**Pronto quando:** os dois personagens aparecem **montados na pose de voo**, sem buracos nas
articulações, com z-order correto (braço de trás atrás do tronco etc.); girar qualquer osso no Pose Lab
gira pela articulação certa; o flip funciona.

---

## Fase 3 — Animação fluida

**Prompt:**
> Execute a Fase 3 do PLANO.md. Implemente loop de passo fixo, clipes com keyframes, mistura, e a camada
> procedural (molas, IK, look-at, flutuação, squash & stretch). Crie os clipes base dos dois personagens.
> Grave screenshots em sequência dos clipes e analise a fluidez.

**Tarefas:**
1. **Loop**: simulação a 120 Hz, renderização interpolada, `timeScale` (câmera lenta), pausa.
2. **Clipes** (`clips/*.json`): keyframes por osso (rotação, offset, escala, slot), easing por keyframe
   (`linear, sineInOut, cubicOut, backOut, elastic...`), loop ou não, **eventos** em frames
   (ex.: `{ "frame": 6, "event": "hitbox:on" }`).
3. **Mistura**: crossfade entre clipes (padrão 6 frames), e **camadas** (corpo toca `fly` enquanto
   o braço toca `shoot`), com máscara por osso.
4. **Procedural** (somado depois dos clipes):
   - **molas em corrente** (verlet ou mola amortecida por segmento) para abas do sobretudo, paletó,
     gravata, saia do sobretudo e cabelo, reagindo à velocidade e à aceleração do corpo;
   - **IK de 2 ossos** (ombro-cotovelo) para mirar a arma ou alcançar um alvo;
   - **look-at** da cabeça pro oponente, com limite de ângulo;
   - **flutuação/respiração** em seno;
   - **squash & stretch** automático pela aceleração (estica ao arrancar, achata ao frear).
5. **Clipes base** dos dois: `idle_fly`, `dash_forward`, `dash_back`, `brake`, `look_back`, `hurt_light`,
   `hurt_heavy`, `knockback_spin`, `recover`, `splat` (bater de cara), `fall`. Faça os keyframes no Pose Lab ou direto no JSON,
   sempre com antecipação, exagero e *overshoot*.

**Pronto quando:** no `?scene=anim`, cada clipe toca com transições sem salto; o tecido balança e
assenta depois de uma freada; nada se move em velocidade constante sem easing; 60 fps estáveis.

---

## Fase 3.5 — Poses-imagem (skin deformada por ossos), começando pelo voo

O rig de peças é de perfil e os desenhos de pose têm perspectiva: as peças não reproduzem a pose de
voo. Cada personagem passa a ter uma **biblioteca de poses-chave em imagem** (voo, dash, soco, chute,
tiro, levando golpe, caindo, esborrachado), cada uma com a própria imagem, malha, pesos e posições de
articulação, mas com os **mesmos nomes de ossos**, para que clipes e molas funcionem em qualquer pose.
Por enquanto só a pose de voo; a estrutura fica pronta pras outras.

**Prompt:**
> Execute a Fase 3.5 do PLANO.md. Recorte a pose de voo das folhas, posicione o esqueleto sobre a
> imagem, gere malha e pesos automáticos, renderize com WebGL próprio (fallback Canvas 2D) e adicione
> setSkin/setPose com troca mascarada. Valide com screenshots e analise antes de concluir.

**Tarefas:**
1. **Recorte:** `npm run atlas -- pose <folha> --char <c> --pose fly --rect x,y,w,h` → `assets/fly/<char>.png`
   (fundo branco removido, só a figura). Índice das poses do personagem em `assets/skins/<char>.json`.
2. **Esqueleto sobre a imagem** (`assets/<pose>/<char>.skin.json`): raiz no quadril, tronco, pescoço,
   cabeça, ombro/cotovelo/punho dos dois braços, quadril/joelho/tornozelo das duas pernas, 3 ossos em
   corrente para as abas do sobretudo/paletó e 3 para a gravata. Nomes canônicos iguais em todas as poses.
   No Pose Lab: a imagem com os ossos, arrastar articulações pra corrigir e salvar.
3. **Malha automática:** triangular a silhueta (alfa) com ~400–800 vértices, mais densos perto das
   articulações e nas bordas.
4. **Pesos automáticos:** por distância (geodésica) ao segmento de cada osso, suavizado, no máximo 4
   ossos por vértice, normalizado; o sobretudo e a gravata pesam nas correntes.
5. **Renderizador:** WebGL mínimo, sem libs, com skinning linear (LBS) no shader; fallback Canvas 2D
   desenhando triângulos com transformação afim.
6. **Movimento:** o `idle_fly` e as molas da Fase 3 atuam nesses ossos com limites pequenos
   (membros ±12°, tecido ±25°); flutuação, respiração e squash & stretch na raiz.
7. **API:** `character.setSkin('image' | 'parts', { transition })` (o voo usa `image`, os golpes `parts`)
   e `character.setPose(nome, { transition: 'afterimage' | 'flash' | 'smear' | 'cut' })`, com a troca mascarada.

**Pronto quando:** (a) parado, idêntico à referência, com a diferença de pixels reportada; (b) 6 quadros
do `idle_fly` sem rasgo, dobra estranha ou buraco; (c) modo debug mostra malha e ossos; (d) as quatro
transições funcionam. Screenshots abertos e analisados antes de concluir.

---

## Fase 4 — Ações, golpes e contato

**Prompt:**
> Execute a Fase 4 do PLANO.md. Normalize a escala das poses, importe as poses da perseguição,
> implemente o movimento dirigido, o formato de golpes em fases com troca de pose, hitboxes e hurtboxes
> presas aos ossos da pose atual com reação automática ao contato, projéteis e ações registradas. Crie
> os golpes iniciais. Valide com o modo debug e screenshots.

**Tarefas:**
1. **Normalização de escala entre poses:**
   - ao importar uma pose (`npm run atlas -- pose …`), o CLI mede uma referência estável, a **altura da cabeça** (topo do cabelo ao queixo), e calcula o fator que a iguala à da pose `fly`;
   - o fator fica gravado no `skin.json` da pose (`scale`) e pode ser ajustado no Pose Lab, com a `fly` como fantasma ao lado para comparar;
   - a **âncora passa a ser o quadril** (raiz) entre poses-imagem: na troca, o quadril da pose nova fica onde estava o da antiga;
   - o alinhamento com o rig de peças (pescoço, Fase 3.5) só vale quando a troca envolve `parts`.
2. **Formato e conversão das imagens:**
   - o CLI grava cada pose em **WebP com alfa**, lado maior até **1024 px**, meta de **≤ 200 KB** (avisa se passar), mais uma versão **@2x** opcional;
   - o carregamento escolhe a @2x só com DPR > 1,5;
   - `head`/`tail` do esqueleto continuam em px da imagem 1x.
3. **Poses-chave, na ordem da perseguição:**
   - **agente (smith):** `fly` (pronta), `shoot`, `splat`, `fall`;
   - **neo:** `fly` (pronta);
   - `punch`, `kick`, `hurt` e `dash` entram quando o usuário fornecer as imagens. Até lá, o combo usa **imagens provisórias** (outra pose existente ou o rig de peças).
   - Cada pose nova segue o fluxo da Fase 3.5: recortar, normalizar a escala, ajustar o esqueleto no Pose Lab e salvar.
4. **Movimento dirigido:** `moveTo` (ponto ou rota Bézier, com easing e duração), `dash` (impulso com rastro), `hover` (flutuar parado), recuo físico (knockback com arrasto) e "profundidade" por escala.
5. **Golpes em fases** (`moves/*.json`):
   - o golpe declara as poses que usa (`"poses": ["shoot"]`), que são carregadas antes. Pose inexistente gera erro claro na carga;
   - cada fase tem `name, frames, pose, transition, clip, fx[], camera, spawn, hitboxes[], run` (ação TS);
   - `pose` + `transition` trocam a pose na entrada da fase. Sem `transition`, usa o padrão: `smear` ao sair da pose base e `afterimage` ao voltar para ela;
   - o `clip` (opcional) anima os ossos da pose atual dentro dos limites (±12°/±25°): o impacto vem da troca de pose e do movimento do corpo;
   - `onHit`: `hitstop, knockback, targetPose (+ transition), targetClip, fx[], camera`. Ver "Golpes customizados".
6. **Hurtboxes:** cápsulas presas aos ossos **da pose atual**, geradas por pose (uma por osso do corpo, raio estimado pela largura da silhueta em volta do osso). Trocam junto com a pose e são atualizadas a cada passo.
7. **Hitboxes:** presas a ossos pelo nome (`{ "bone": "hand_front", "radius": 40 }`). Como os nomes são iguais em todas as poses, a mesma hitbox vale em qualquer uma.
8. **Contato:** colisão cápsula × cápsula / círculo. Ao encostar, dispara `onHit` uma vez por fase ativa e emite o evento `hit` (que o roteiro pode esperar: "quando acertar, faça X").
9. **Projéteis:** bala do agente e rajada/feixe de energia, com hitbox e efeitos próprios. O tiro sai do osso `hand_front` da pose `shoot`.
10. **Ações registradas:** `registerAction(nome, (ctx) => {...})`, com `ctx` dando acesso a `self`, `target`, `fx`, `camera`, `scene`, `rng`. Ações embutidas: `teleport_behind`, `vanish`, `appear`.
11. **Golpes iniciais:** `shoot` (pose `shoot`, IK leve mirando o alvo), `jab`, `jab2`, `heavy_punch` (lança longe), `kick`, `energy_blast`, `dash_strike`. Os quatro últimos usam imagens provisórias até chegarem as poses.
12. **Debug** (`?debug=1`): ossos, hurtboxes (azul), hitboxes ativas (vermelho), pose atual (`image:shoot`), fase e frame atual, e a malha (opcional).

**Pronto quando:**
- a **perseguição** mostra o agente em `fly` → `shoot` (o tiro acerta à distância) → `splat` (bate de cara na porta) → `fall`, sem pulo nem mudança de tamanho nas trocas;
- o combo `jab → jab2 → heavy_punch` (com imagens provisórias) faz o alvo reagir sozinho a cada contato e ser lançado;
- as hitboxes só existem nos frames ativos e seguem os ossos da pose atual;
- passam os testes de colisão, do sequenciador de fases e da normalização de escala.

---

## Fase 5 — Game feel e efeitos

**Prompt:**
> Execute a Fase 5 do PLANO.md. Implemente hitstop, tremida de câmera por "trauma", flash de impacto,
> partículas, afterimages, smear na troca de pose, linhas de velocidade, câmera automática e dirigível, e câmera lenta por trecho. Valide com screenshots no momento exato dos impactos.

**Tarefas:**
- **Hitstop**: atacante e alvo congelam N frames (a câmera continua tremendo).
- **Tremida de câmera** baseada em trauma (decai com o tempo, intensidade ao quadrado, ruído suave).
- **Flash** branco ou de cor no alvo por 2 a 3 frames.
- **Faíscas e estrela de impacto** na posição do contato.
- **Afterimages**: cópias translúcidas do personagem no dash e nos golpes rápidos. Viram efeito geral (`fx.afterimage`), o mesmo da transição de volta de pose.
- **Smear** (borrão de 2 a 3 quadros) na troca de pose: cópias entre a pose antiga e a nova, esticadas ao longo da velocidade, com alpha decrescente. É a transição padrão de ida e fica disponível em `fx.smear(actor, frames)`.
- O **hitstop** congela também a transição de pose (o borrão não anda durante o congelamento).
- **Linhas de velocidade** e **paralaxe do cenário** (céu, cidade em camadas).
- **Câmera** que enquadra os personagens (modo automático), mas que o roteiro pode dirigir
  (pan, zoom, seguir um personagem, tremer).
- **Câmera lenta** por trecho do roteiro (ex.: o golpe final).

**Pronto quando:** cada contato "pesa" visualmente (congela, treme, faísca); o dash deixa rastro;
a troca de pose rápida sempre passa pelo smear (nunca mostra um quadro "estalado"); a câmera automática
nunca corta um personagem; nada disso derruba os 60 fps.

---

## Fase 6 — Diretor de cena (roteiro)

**Prompt:**
> Execute a Fase 6 do PLANO.md. Implemente o formato de roteiro e o diretor que o executa, com tempo
> absoluto, relativo e por evento, play/pause/seek determinístico, e a API fluente em TS. Recrie a cena
> da perseguição só com o roteiro e valide com screenshots em vários tempos.

**Tarefas:**
1. **Roteiro** (`scenes/*.json`): lista de passos `{ at | after | on, actor, do, params }`:
   - `at: 2.4`: tempo absoluto em segundos;
   - `after: "step-id" + delay`: depois que outro passo terminar;
   - `on: "hit:smith->neo"`: quando um evento acontecer;
   - `do`: `enter, moveTo, dash, hover, face, pose, play (clipe), move (golpe), expression, hand, say (balão),
     camera (follow/zoom/shake/pan), fx, wait, spawnProp (ex.: porta), parallel [...]`.
   - `pose`: `{ "do": "pose", "params": { "name": "shoot", "transition": "smear" } }`. Sem `transition`,
     usa o padrão (smear na ida, afterimage na volta); `cut` só se pedido. `skin` (`image`/`parts`) para
     quem também usa peças.
2. **Diretor**: executa o roteiro sobre a simulação de passo fixo; `play()`, `pause()`, `seek(t)`
   (re-simula do início, determinístico), `progress`, `duration`, `loop`, `timeScale`, eventos
   (`step`, `hit`, `end`).
3. **API fluente em TS** equivalente ao JSON:
   `scene.at(0).actor('neo').moveTo(route, 1.6).then().actor('smith').pose('shoot').move('shoot', { target: 'neo' })`.
   `seek` recria a pose atual de forma determinística (a troca de pose entra na re-simulação).
4. **Props**: objetos de cena simples (porta que surge/abre/fecha, paredes), com clip-path de "entrar".
5. **Cena "perseguição"** (`?scene=chase`) recriada só com roteiro e APIs públicas: fuga (neo em `fly`),
   tiros (agente em `shoot`), porta, entrada, porta batendo e a reação do agente (`splat` → `fall`).

**Pronto quando:** a perseguição roda igual em toda execução; `seek` para qualquer segundo mostra o
quadro correto; um roteiro novo pode ser escrito só em JSON.

---

## Fase 6.5 — Narrativa → roteiro

Um texto em pt-BR ("o agente persegue o neo pelos telhados, atira duas vezes, o neo desvia e some
numa porta; o agente bate de cara e cai") vira um `scenes/*.json` válido.

**Decisão (2026-11-16): nenhuma API de IA paga, nenhuma chave.**
- Quem escreve a cena é o **Claude Code**, pelo comando customizado `/narrate <narrativa>` (`.claude/commands/narrate.md`).
- `tools/narrator` só tem **ferramentas determinísticas**, sem nenhuma chamada de IA.
- Saíram do plano o endpoint de backend e a geração automática de imagem por API (`--generate`). Quem gera a imagem é o usuário, com o prompt pronto.
- Continuam `pose:add`, `pose:list` e as provisórias.
- Fica preparada (sem implementar) a interface `NarratorProvider`, para um modo opcional com modelo local via Ollama.

**Ciclo de poses:** o Claude Code mapeia cada ação da narrativa para uma pose pelo nome, pela descrição
e pelas tags do catálogo. Se a pose não existe:
1. a cena usa o nome novo, declarado em `missing` com a pose mais parecida (`closest`);
2. `missing` grava a provisória a partir dela (a cena já roda, com a marca PROVISÓRIA) e gera o **prompt de imagem pronto**, a partir do manifesto;
3. o usuário gera a imagem e roda `npm run pose:add` com o mesmo nome;
4. a pose deixa de ser provisória, e a cena roda com a imagem nova sem mudar nada.

**Prompt:**
> Execute a Fase 6.5 do PLANO.md. Crie as ferramentas determinísticas de `tools/narrator` (catalog,
> validate, missing, preview), o comando `/narrate` em `.claude/commands/narrate.md` e a interface
> `NarratorProvider` (sem implementar). Teste com a narrativa da perseguição e com
> "o neo dá um chute giratório".

**Já existe:**
- manifestos com descrição/tags por pose, `parseManifest` no core;
- `npm run pose:list` com o prompt de cada provisória (`tools/atlas/src/prompt.ts`);
- `npm run pose:add` (pose e `--variant`) e as variantes de textura (`expression`/`hand`);
- o catálogo (`npm run narrate -- catalog`).

**Pré-requisitos da Fase 6:** `parseScript`/`checkScript` validam o roteiro; o diretor roda sem navegador (as poses são decodificadas em Node com sharp e passam por `buildImagePose`, que é puro).

**Tarefas:**
1. **Pacote `tools/narrator`** (TypeScript strict, **sem dependência de IA**; usa sharp, e vite + playwright no `preview`). CLI `npm run narrate -- <comando>`:
   - **`catalog`:** tudo o que existe, montado só dos manifestos e dados, em JSON estável (chaves ordenadas):
     - personagens: descrição, pose base, poses com `description`/`tags`/`variants`, provisórias com `from`, golpes (poses, duração, tipo de ataque, `targetPose`);
     - clipes, efeitos, props (estados e ações), ações registradas, transições, comandos do roteiro e eventos.
   - **`validate <cena.json>`:**
     - formato (`parseScript`) e nomes contra o catálogo (`checkScript`);
     - coerência com o arquivo lateral (todo `match: missing` do `poseMap` está em `missing`; todo `closest` existe);
     - poses pendentes (declaradas e ainda não criadas: "rode missing");
     - simulação seca até o fim: duração, passo `on` que nunca dispara, evento esperado (`expectations`) que não acontece, cena sem fim, ator visível fora do quadro;
     - avisos: variante que falta na pose atual, provisória em uso;
     - código de saída ≠ 0 com erro; `--json`.
   - **`missing <cena.json>`:** grava como provisórias as poses declaradas em `missing` (variação neutra a partir de `closest`; `--no-provisional` não grava) e gera `scenes/<nome>.missing.md` com, em blocos prontos para copiar:
     - as poses sem imagem que a cena usa: as novas e as provisórias que já existiam, inclusive as que entram por golpes;
     - as variantes que faltam;
     - o esqueleto dos golpes que faltam.
     - Cada pose ou variante leva o prompt de imagem **montado do manifesto** (igual sempre: descrição e estilo do personagem, a pose, as regras fixas), as referências para anexar e o comando `pose:add` já preenchido.
   - **`preview <cena.json>`:** acha os tempos-chave na simulação seca (logo depois de cada troca de pose, golpe, entrada, prop, contato, e o fim), tira screenshots pela demo (`?scene=script&file=…&t=…`, seek determinístico) e monta uma folha de contato com o tempo e o que acontece em cada quadro (`apps/demo/shots/out/preview/<nome>/contato.png`). Opções: `--times`, `--debug`.
2. **Arquivo lateral** `scenes/<nome>.narrative.json`: `{ narrative, poseMap[], missing[], expectations[], assumptions[] }`.
   - `poseMap`: `{ action, char, pose, match: exact|similar|provisional|missing, from?, reason }`, o rastro da decisão para o usuário conferir.
     - Pose provisória aparece como `provisional`, com `from` (a pose de onde vem a imagem), nunca como `exact`/`similar`: o `validate` recusa.
     - O `missing` troca `missing` → `provisional` quando cria a provisória.
   - `missing`: `{ kind: "pose", char, name, description, tags, closest, why }`, `{ kind: "variant", char, pose, name, variantKind, description, tags, why }` ou `{ kind: "move", char, name, why, phases[] }`.
   - O roteiro fica no formato do motor, sem campos extras.
3. **Comando `/narrate <narrativa>`** (`.claude/commands/narrate.md`), que instrui o Claude Code a:
   - rodar o catálogo;
   - mapear a narrativa para poses, variantes, golpes e props (com o `poseMap`);
   - escrever `scenes/<nome>.json` e o arquivo lateral;
   - rodar `validate` → `missing` → `validate` → `preview`, abrir os screenshots e corrigir o que estiver errado (no máximo umas 4 voltas);
   - mostrar o resultado com a folha de contato, o `poseMap` e a lista do que falta (com os comandos `pose:add` e o `.missing.md`).
4. **`NarratorProvider`** (`tools/narrator/src/provider.ts`): `available()` e `draft({ narrative, catalog, examples, previous? }) → { scene, narrative }`. É a porta para um modelo local via Ollama, **não implementada**. O laço escrever → validar → corrigir fica fora do provedor.
5. **Demo:** `?scene=script&file=scenes/x.json` toca qualquer cena (`&debug=1`, `&at=hit:N`); `SF_ASSETS=<pasta>` serve outra pasta de assets.

**Testes:**
- **Manifesto:** formato novo e antigo, nome repetido entre `poses` e `provisional`, `styleRefs` inexistente.
- **`pose:add`:** registro com `description`/`tags`, saída de `provisional`, erro de nome repetido, variante (enquadramento, aviso de silhueta), com imagens sintéticas.
- **Catálogo:** a partir de manifestos de exemplo (golpes com duração, provisórias com `from`, variantes).
- **Prompt de imagem:** montado do manifesto, igual entre execuções.
- **Arquivo lateral:** formato e mensagens de erro.
- **validate → missing → validate:** pose pendente, provisória criada (sem duplicar), `.missing.md` com prompt e `pose:add`, `--no-provisional`, coerência do `poseMap`, variante e golpe que faltam, provisória usada por golpe, evento esperado que não acontece.
- **preview:** tempos-chave da perseguição (pose, entrada, contato, fim, espaçados).

**Pronto quando:**
- `/narrate` com a narrativa da perseguição gera uma cena que passa no `validate` e cuja prévia conta a história (fuga, tiros, esquiva, porta, splat, fall), com o `poseMap` sem `missing` (as provisórias, como a `dodge`, marcadas `provisional ← fly`);
- **ciclo completo** com "o neo dá um chute giratório":
  1. a cena declara `kick_spin` em `missing`;
  2. o `missing` cria a provisória a partir de `kick` e gera o prompt de imagem com a descrição do personagem, o estilo, as referências e o comando `pose:add`;
  3. a cena roda com PROVISÓRIA;
  4. depois de `pose:add` com uma imagem, a mesma cena roda com a imagem nova e sem a marca, sem mudar o roteiro;
- os testes passam sem rede e sem IA.

---

## Fase 7 — Angular

**Prompt:**
> Execute a Fase 7 do PLANO.md. Crie a lib Angular ngx-sprite-fighter (ng-packagr), com o componente
> standalone sf-scene, e um app de exemplo. Garanta que o loop roda fora da zona do Angular.

**Tarefas:**
- Componente standalone `<sf-scene>`:
  - inputs: `characters`, `script`, `autoplay`, `loop`, `debug`, `timeScale`;
  - outputs: `(ready)`, `(step)`, `(hit)`, `(end)`;
  - métodos via `@ViewChild`: `play()`, `pause()`, `seek(t)`.
- Loop em `NgZone.runOutsideAngular`; eventos reentram na zona só quando emitidos.
- `ResizeObserver` + DPR; limpeza total no `ngOnDestroy` (loop, listeners, observers).
- Assets carregados por URL, com cache. Um personagem pode ser definido só por poses
  (`{ poses: 'skins/neo.json', moves }`, sem atlas/rig). As poses citadas pelo roteiro carregam antes do
  `(ready)`, já na resolução certa (@2x só com DPR > 1,5).
- Input `webgl` (desligado força o fallback Canvas 2D). O `ngOnDestroy` libera também o contexto WebGL
  (texturas e buffers).
- App de exemplo com a perseguição e uma cena de luta roteirizada; opção de tocar a cena quando ela
  entra na tela (IntersectionObserver).

**Pronto quando:** `ng build ngx-sprite-fighter` gera o pacote; o app de exemplo roda as cenas;
sair da rota não deixa loop nem listener vivos.

---

## Fase 8 — Documentação e acabamento

**Prompt:**
> Execute a Fase 8 do PLANO.md. Escreva o README em pt-BR, o guia de novo personagem e de novo golpe,
> meça o desempenho e o tamanho do bundle e corrija o que estiver acima do orçamento.

**Tarefas:**
- README: instalação, uso no Angular, uso sem framework, API pública, formato do roteiro.
- **Guia "novo personagem"**:
  1. gerar as poses-chave na IA de imagem (voo, tiro, esborrachado, caindo, soco, chute, levando golpe, dash): mesmo personagem, fundo branco, de perfil para a direita;
  2. recortar com `npm run atlas -- pose … --pose <nome>` (WebP, normalização de escala pela cabeça);
  3. ajustar o esqueleto no Pose Lab (modo Pose-imagem, partindo do esqueleto de outra pose) e salvar;
  4. conferir em `?scene=skin&mode=debug`.

  A folha de peças (`parts`) fica num apêndice opcional.
- **Guia "nova pose"**: recortar → conferir e ajustar a escala → esqueleto → `follow` para membros sobrepostos → testar as transições (smear na ida, afterimage na volta).
- **Guia "novo golpe"**: escolher ou gerar as poses → fases com `pose`/`transition` → hitboxes no debug →
  ação TS registrada se precisar de algo novo.
- **Guia "nova cena"**: escrever o roteiro em JSON, testar com `seek`.
- **Orçamento**: player (`sprite-fighter`) **≤ 54,5 KB gzip** (o medido em 2026-11-17, 49,5 KB, + 10 % de margem;
  era < 40 KB). O que é só de autoria fica em `sprite-fighter/authoring`, fora do bundle do player. Cada pose em
  WebP ≤ 200 KB (lado maior ≤ 1024 px, @2x só sob demanda); **as imagens das poses são o peso dominante**: a
  perseguição baixa ~480 KB de WebP contra os 49,5 KB do player. 60 fps com 2 personagens + efeitos num notebook
  comum, medidos com WebGL e com o fallback 2D.

**Pronto quando:** alguém consegue criar um terceiro personagem e um golpe novo só seguindo os guias.

---

## Golpes customizados

Todo golpe é um JSON em fases. Um especial usa o mesmo formato:

```jsonc
{
  "id": "meu_especial",
  "poses": ["charge", "punch"],
  "phases": [
    { "name": "carregar", "frames": 30, "pose": "charge", "transition": "smear",
      "fx": [{ "type": "aura", "bone": "torso", "color": "#7fd1ff" }],
      "camera": { "zoom": 1.2, "shake": 0.15 } },
    { "name": "sumir", "frames": 6, "run": "teleport_behind" },
    { "name": "soltar", "frames": 8, "pose": "punch",
      "spawn": { "projectile": "beam", "from": "hand_front", "speed": 1400 } },
    { "name": "ativo", "frames": 20, "hitboxes": [{ "bone": "hand_front", "radius": 40 }] },
    { "name": "recuperar", "frames": 18, "pose": "fly", "transition": "afterimage" }
  ],
  "onHit": { "hitstop": 8, "knockback": { "x": 900, "y": -200 },
             "targetPose": "hurt", "fx": ["impact_big", "flash"] }
}
```

`pose` troca a pose-chave na entrada da fase. Sem `transition`, usa o padrão: `smear` na ida, `afterimage` na volta para a pose base; `cut` só se pedido. O `clip` é opcional e anima os ossos da pose atual dentro dos limites.

O que os dados não cobrem vira uma ação TS, registrada uma vez:

```ts
registerAction('teleport_behind', ({ self, target, fx }) => {
  fx.afterimage(self);
  self.position = target.position.add({ x: -120 * target.facing, y: 0 });
  self.face(target);
});
```

## API pública alvo (referência)

```ts
import { Scene, Character } from 'sprite-fighter';

// Só poses-imagem (modo principal); atlas/rig de peças são opcionais.
const neo = await Character.load({ poses: 'skins/neo.json', moves: 'neo.moves.json' });
const smith = await Character.load({ poses: 'skins/smith.json', moves: 'smith.moves.json' });
smith.setPose('shoot');                    // transição padrão: smear (ida); de volta à fly: afterimage

const scene = await Scene.create(canvas, { width: 1280, height: 720, characters: { neo, smith } });
await scene.load('scenes/chase.json');   // ou a API fluente
scene.on('hit', e => console.log(e.attacker, e.move));
scene.play();
```

```html
<sf-scene [characters]="characters" [script]="'scenes/chase.json'" [autoplay]="true" (end)="onEnd()"></sf-scene>
```

```jsonc
// scenes/chase.json (trecho)
[
  { "id": "fuga", "at": 0, "actor": "neo", "do": "moveTo", "params": { "route": "M-160 560 C 500 420 1100 560 1500 520", "duration": 1.6, "ease": "sineIn", "scaleTo": 0.32 } },
  { "at": 0.15, "actor": "smith", "do": "moveTo", "params": { "to": [1450, 500], "duration": 1.9, "ease": "power2In" } },
  { "at": 0.65, "actor": "smith", "do": "pose", "params": { "name": "shoot" } },
  { "at": 0.7, "actor": "smith", "do": "move", "params": { "id": "shoot", "target": "neo" } },
  { "at": 0.8, "do": "spawnProp", "params": { "type": "door", "at": [1500, 520] } },
  { "on": "hit:door->smith", "actor": "smith", "do": "pose", "params": { "name": "splat", "transition": "cut" } },
  { "after": "splat", "delay": 0.4, "actor": "smith", "do": "pose", "params": { "name": "fall" } }
]
```

---

## Estado
_(o Claude Code atualiza esta seção ao fim de cada fase)_

- **Fase 0: concluída (2026-11-15).**
  - Monorepo com npm workspaces: `packages/core` (lib `sprite-fighter`, sem deps de runtime, build `tsc -b`), `packages/angular` (só o lugar reservado, Fase 7), `tools/atlas` (CLI stub, Fase 1), `apps/demo` (Vite, porta 5180).
  - `tsconfig.base.json` strict (+ `noUncheckedIndexedAccess`), project references na raiz.
  - Vitest roda da raiz (`vitest.config.ts`, `passWithNoTests`). Playwright com o Chromium baixado por `npx playwright install chromium`.
  - Scripts na raiz: `dev`, `build`, `test`, `typecheck`, `shots` (sobe o Vite programaticamente, abre `?<query>` e espera `body[data-ready=true]`; itens em `apps/demo/shots/shots.json` ou como argumentos; saída em `apps/demo/shots/out/`) e `atlas`.
  - **Decisões:**
    - TypeScript **6.0**, não 7, porque o Angular 22 da Fase 7 exige `>=6.0 <6.1`.
    - Vite 8 e Vitest 5.
    - Em dev, a demo usa o código-fonte do core por alias (sem precisar do build).
  - **Pendência:** commits por fase suspensos, porque o usuário pediu para não commitar em nenhum repo ainda (o `git init` local foi feito).
- **Fase 1: concluída (2026-11-15).**
  - **CLI `tools/atlas`:** `npm run atlas -- <folha.png> --char <nome> [--out assets/atlas] [--min-area 400] [--upscale 2]`.
    - Fundo: flood fill a partir das bordas (quase branco: canal mínimo ≥ 240 e saturação ≤ 14). O branco cercado por contorno, como a camisa e os brilhos, continua peça.
    - Borda: na faixa de 1 px, o alfa sai do quanto o pixel é branco e a cor é desmisturada do branco (sem halo claro sobre fundo escuro).
    - Peças: componentes 8-conectados com área ≥ 400. Blocos quase retangulares (preenchimento > 0,85) são divididos nas costuras claras, porque os azulejos de olhos e bocas do smith estão encostados.
    - Numeração em ordem de leitura. Recorte com 2 px de margem, só com os pixels da própria peça.
    - Atlas empacotado em prateleiras com 2 px de espaço.
  - **Saída em `assets/atlas/`:**
    - `<char>.atlas.png` e `<char>.atlas.json` (`version, char, image, width, height, scale, sheet, parts[{name, n, kind, x, y, w, h, sourceRect}]`; o `sourceRect` fica na escala da folha original, mesmo com upscale);
    - `preview-<char>.png`, com peças numeradas, nomeadas e coloridas por tipo;
    - `names/<char>.json`.
  - **Overlay:** olhos e bocas são `kind: "overlay"`. Enquanto não há nomes, a regra é peça quase retangular.
  - **Resultado:**
    - **neo:** 40 peças, 6 overlay (3 olhos, 3 bocas).
    - **smith:** 34 peças, 5 overlay (2 olhos, 3 bocas).
    - Todos os nomes estão na convenção e foram validados na carga (nome faltando, fora da convenção, repetido ou chave sobrando).
  - **Nomes extras dentro da convenção:**
    - `forearm_bare_*`: antebraço sem mão, para as mãos avulsas;
    - `forearm_reach_*`, `forearm_open`, `forearm_gun`: antebraço com a mão desenhada;
    - `head_front`, `head_back`, `head_backside` (smith).
  - **A conferir pelo usuário (`assets/atlas/names/*.json`):**
    - **smith:** quem é `upper_arm_1/2` (22, 28), `joint_cap_1` (23) e `thigh_1/2` (26, 29) × `shin_1/2` (31, 32);
    - **neo:** `forearm_bare` (17, 19) × `upper_arm` (16, 18).
  - Testes: fundo, componentes, ordem de leitura, empacotamento, divisão de azulejos e nomes (13 testes).
- **Fase 2: concluída (2026-11-15).**
  - **Core** (`packages/core/src`, ainda sem deps de runtime):
    - `math` (Mat2D na ordem do canvas, ângulos);
    - `geometry`: `PartGeometry`, port do `Geo` do Python, com PCA sobre os pixels opacos, pontas pela mediana e recuo `min(0,45·largura, 0,25·comprimento)`;
    - `validate` (Reader/DataError, com caminho do campo nas mensagens);
    - `atlas` (`parseAtlas`);
    - `rig`: formato, `parseRig` (peças, mães e ossos inexistentes, repetidos, ciclos, angle × rotate) e `solveRig` (port de `solve`: P, D, R, T, rel);
    - `skeleton`: pose por osso (rotação, offset, escala, slot), raiz com flip, matrizes de mundo e `drawList` (filhos de trás, peça, filhos da frente; o cap entra depois do que vier por último entre a peça do osso e a da mãe);
    - `character` (`Character.load`/`fromData`: o alfa das peças vem do atlas via OffscreenCanvas para o PCA);
    - `renderer`: `CanvasRenderer` com DPR, resize, câmera, `screenToWorld` e flash por camada `source-atop`, já pronto para a Fase 5.
  - **Formato do rig** (`assets/rigs/<char>.rig.json`):
    - por osso: `name, part, parent, pivot, attach, angle|rotate, inset, layer, order, position, scale, slots, hidden`;
    - mais `caps[{name, part, bone, at, scale}]` e `chains[{name, bones, stiffness, damping}]`, que por enquanto são só dados para a Fase 3.
    - Olhos e bocas são ossos filhos da cabeça, com `hidden: true`.
  - **Rigs:**
    - **neo:** 19 ossos, 4 caps (joelhos, cotovelos), 4 chains (3 abas e saia).
    - **smith:** 20 ossos, 1 cap (ombro), 4 chains (3 abas e gravata).
    - Os dois estão na pose de voo: o neo com o braço da frente estendido; o smith com os braços para trás e a gravata.
  - **Demo:**
    - `?scene=rig`: os dois, smith virado. Aceita `&char=`, `&flip=1`, `&debug=1`, `&names=1`, `&zoom=`.
    - `?scene=poselab&char=`:
      - seleção por clique com teste de alfa ou pela lista; arrastar gira pela articulação (com flip, o sinal se inverte); slots; virar; ossos; zoom na roda; Shift + arrastar move a vista;
      - **Exportar pose** gera os deltas por osso; **Exportar rig** embute a pose, somando o giro acumulado nos ângulos de mundo;
      - para screenshots aceita `&rot=osso:graus,…`, `&select=` e `&flip=1`.
    - O Vite serve `assets/` como publicDir.
  - **Correções no caminho:**
    - **Atlas:** o limite de cor opaca na borda foi de 200 para 100. O contorno é escuro (~60), e com 200 a desmistura deixava um pontilhado claro em volta das peças. Atlas regerados.
    - **PCA:** a caixa estava meio pixel deslocada, porque os pontos são centros de pixel. Pego pelo teste.
  - **Decisão:** as peças `ankle_*` (meia branca) ficaram fora dos caps do neo, porque apareciam como um "buraco" branco no tornozelo. O sapato encaixa direto na canela.
  - **Pendências de autoria** (ajuste fino no Pose Lab): a gravata do smith subir pelo ombro como no desenho de referência; a orientação dos sapatos; usar ou não `ankle_*`.
  - **Testes:** 36 no total (math, PCA, `parseRig` com mensagens de erro, `solveRig`, esqueleto: rotação por articulação, flip, ordem de desenho e caps, slot escondido).
- **Fase 3: concluída (2026-11-15).**
  - **Core novo:**
    - `easing`: 19 curvas, entre elas `sineInOut`, `cubicOut`, `backOut`, `elastic`, `bounceOut`, `power2In/Out`.
    - `loop`: `FixedClock` a 120 Hz com alpha de interpolação, `timeScale`, pausa e teto de 0,25 s por quadro; `runLoop` com rAF; frames de autoria a 60 fps.
    - `clip` (`clips/*.json`):
      - ossos `rot/x/y/scale`, raiz `x/y/rot/sx/sy`, slots com `"default"`/`"none"` e eventos por frame;
      - o easing por chave vale para o trecho que chega nela;
      - `checkClip` confere o clipe contra o rig.
    - `animator`: camadas com máscara por osso (inclui descendentes), crossfade com smoothstep (padrão de 6 frames), eventos uma vez por passagem (inclusive na volta do loop), `finished()`.
    - `procedural`:
      - `SpringChain`: massa na ponta presa à pose do clipe, comprimento fixo, limite de ±55°;
      - `solveTwoBone`/`aimTwoBone` (IK, inclusive espelhado);
      - `lookAt` com limite;
      - `hover` (seno);
      - `SquashStretch`: aceleração ao longo da velocidade, mola crítica, ±0,12.
    - `actor`: corpo (posição e velocidade), aceleração suavizada, animator, procedural (look-at, IK, molas das chains do rig), inclinação do tronco pela velocidade vertical. Usa dois esqueletos: `sim` (passo fixo) e `view` (interpolado no render).
    - `skeleton`: a raiz ganhou `stretch/stretchAngle` (preserva a área) e `sx/sy`.
  - **Clipes** (`assets/clips/`, iguais para neo e smith porque os ossos têm os mesmos nomes):
    - `idle_fly`, `dash_forward`, `dash_back`, `brake`, `look_back`, `hurt_light`, `hurt_heavy`, `knockback_spin` (−720° na raiz), `recover`, `splat` (sx/sy com `elastic`) e `fall`;
    - todos com antecipação, exagero e overshoot (`backOut`/`expoOut`), nenhum trecho linear.
  - **Molas por chain nos rigs:**
    - abas do neo: rigidez de 0,2 a 0,3; saia do neo: 0,6;
    - abas do smith: 0,25 a 0,35; gravata do smith: 0,2, em `tie_mid` e `tie_tail`.
  - **Demo `?scene=anim&char=&clip=`:**
    - cada clipe roda dentro de um roteiro curto de movimento (`brake` = dash e depois freada; `knockback_spin` → `recover`; `splat` após o dash; `fall` com gravidade);
    - a câmera segue o personagem e linhas de fundo dão a referência de movimento;
    - ao vivo: botões, câmera lenta e medidor de FPS;
    - `&t=` simula de forma determinística até o instante (screenshots); `&cloth=0`, `&hover=0`, `&squash=0` desligam as camadas.
  - **Verificado:**
    - sequência da freada (as abas arrastam, passam do ponto e assentam);
    - folhas de contatos dos 11 clipes nos dois personagens;
    - crossfade sem salto (< 15° por passo num corte de 90°);
    - determinismo (duas execuções iguais dão a mesma pose);
    - ~310 fps sem vsync com renderização por software, ou seja, 60 fps com folga;
    - 54 testes.
  - **Pendências / ajustes finos:**
    - poses dos clipes ainda podem ser refinadas no Pose Lab;
    - os clipes usam só o slot `head_shout`, que existe nos dois. Expressões próprias (`head_lookup` do neo, `head_grin` do smith) podem entrar em clipes por personagem.
- **Correção pós-Fase 3 (2026-11-15), a pedido do usuário:** a pose de repouso dos rigs estava diferente da pose de voo dos desenhos de referência (`assets/reference/*-draft.png`). Os rigs foram refeitos comparando com o desenho lado a lado.
  - **Inclinação:** `tilt` de −16° (neo) e −18° (smith). O corpo fica em diagonal, com os pés mais baixos que a cabeça.
  - **Pernas:** `inset` de 0,1 nas coxas e canelas. O recuo automático (25% do comprimento) encurtava as pernas, que agora saem por baixo do sobretudo e descem para trás.
  - **Sapatos:** com a ponta para trás e para baixo (`rotate` 145–150), não mais de cabeça para baixo.
  - **neo:**
    - saia e abas do sobretudo esvoaçando para cima e para trás;
    - braço dobrado por cima do sobretudo (camada da frente), estendido para trás com a mão perto do quadril, com `inset` de 0,12;
    - sem os caps dos cotovelos, cujo contorno aparecia como círculos sobre a manga.
  - **smith:** braços retos para trás com as mãos espalmadas; gravata por cima dos braços, subindo pelo ombro e esvoaçando para trás.
  - **Clipe `brake` refeito:** tronco para trás, pernas para a frente com os joelhos dobrados, braços abrindo. Antes, somado ao tilt, deixava o personagem em pé, reto.
  - **Demo:** com um personagem só, o `?scene=rig` não espelha mais (`&flip=1` espelha).
  - **Lição:** toda mudança visual de rig precisa ser comparada com o desenho de referência, não só "parecer montada".
- **Segunda correção (2026-11-15):** o usuário reprovou de novo, porque a pose ainda não batia com o desenho de voo.
  - **Medição:** comparei o desenho e o render na mesma escala, com a cabeça do mesmo tamanho, medindo cada parte em alturas de cabeça (H). As peças da folha têm proporções diferentes das do desenho: no neo, o tronco do ombro ao quadril tinha 1,9 H contra 2,5 H, o braço 1,4 H contra 1,8 H, e as pernas eram curtas.
  - **Novo no rig: `stretch` por osso.** Alonga a peça ao longo do eixo PCA, sem engordar, e as filhas acompanham o encaixe. Afeta o desenho da peça, a outra ponta (`endWorld`), os caps e o `T` das filhas. Os testes continuam passando.
  - **neo:**
    - tronco quase horizontal (`rotate` 86 → ~70° no mundo) com `stretch` 1,3;
    - braços com `stretch` 1,12 a 1,3; coxas e canelas com 1,3 a 1,35;
    - cabeça encaixada acima da linha do ombro, com o braço estendido saindo de baixo do queixo (antes passava na frente do rosto);
    - saia e abas correndo para trás;
    - sem os discos de joelho.
  - **smith:** braços com `stretch` 1,45 e 1,2, com as mãos na altura das coxas; gravata maior (escala 1,25 e 1,4).
- **Nomes do atlas conferidos com o usuário (2026-11-15):** nenhum nome trocado.
  - **neo:** 30 e 31 são as coxas (tubos lisos); 34 e 35 são as canelas (franzidas na barra); 16 e 18 são os braços de cima; 17 e 19 são os antebraços sem mão.
  - **smith:** a 26 é mesmo uma coxa (`thigh_1`, desenhada mais curta pela IA); 29, 31 e 32 são `thigh_2`, `shin_1` e `shin_2`.
  - **Pernas do smith:** a `thigh_1` passou para a perna de trás (pivô na ponta larga, `stretch` 1,25 só no eixo longo, ficando com 347 px contra os 346 da `thigh_2`), onde aparece só em parte. A `thigh_2` foi para a perna da frente.
- **Fantasma de referência e pose `fly_rest` (2026-11-15, a pedido do usuário):**
  - **Pose Lab, fantasma:**
    - a folha do personagem (`/reference/<char>-draft.png`) ou qualquer imagem do disco aparece atrás do rig;
    - opacidade do fantasma e do rig;
    - "Mover fantasma": arrastar move e a roda escala em volta do cursor; também há um slider de escala;
    - o alinhamento fica salvo por personagem no localStorage; o ponto de partida já sobrepõe as cabeças.
  - **Poses nomeadas** (`assets/poses/<char>/<nome>.json`):
    - mesmo formato do "Exportar pose" (`rotate` em graus, `x`, `y`, `scale`, `slot`), lido por `parsePose`, que valida contra o rig;
    - no Pose Lab, **Carregar pose** e **Salvar pose**; a `fly_rest` abre automaticamente;
    - o salvamento usa o endpoint `POST /__sf/save` do servidor de dev (plugin no `vite.config`), que só aceita `poses/<char>/<nome>.json`.
  - **Clipes:** o campo `"pose"` faz o animator somar a pose do personagem por baixo das chaves. Isso entra também no crossfade, e a pose pode trocar slots. Pose não carregada gera erro ao tocar o clipe.
  - **`idle_fly`** usa `"pose": "fly_rest"`. As duas `fly_rest` começam vazias (= repouso do rig) até o usuário salvar.
  - 4 testes novos (58 no total).
  - **Observação:** os outros clipes continuam relativos ao repouso do rig. Se a `fly_rest` se afastar muito do repouso, dá para colocar `"pose": "fly_rest"` neles também, ou embutir a pose no rig com "Exportar rig".
- **Fase 3.5: concluída (2026-11-15).** Poses-imagem (skin deformada por ossos), começando pela de voo.
  - **Recorte:** `npm run atlas -- pose <folha> --char <c> --pose fly --rect x,y,w,h` grava `assets/fly/<char>.png`.
    - Fica o maior componente e os que encostam nele; pedaços na borda do retângulo saem.
    - Remove vãos fechados de branco puro (≥ 250, área ≥ 200), como o vão entre o braço e o sobretudo do neo, mais um anel de antisserrilhado. A camisa e as luzes (~244) ficam.
    - Índice das poses em `assets/skins/<char>.json` (`default` + `poses`).
    - Retângulos (pose antiga, já substituída): neo `690,4,846,400`; smith `790,15,700,450`.
  - **`assets/<pose>/<char>.skin.json`:**
    - campos `scale` (px do mundo por px da imagem: neo 2,0, smith 1,47), `bones[{name, parent, head, tail, limit, follow?}]`, `chains` e `mesh{target, boundaryStep, seed, clothTolerance}`;
    - esqueleto canônico `SKIN_BODY` (16 ossos do corpo, mesmos nomes do rig de peças) mais correntes livres (abas `coat_tail_1..3` / `jacket_tail_1..3`, gravata `tie_1..3`);
    - `parseSkin` valida e exige os mesmos ossos em todas as poses do personagem;
    - `follow`: as pernas de trás copiam a rotação das da frente, porque estão sobrepostas no desenho e, separadas, esticavam a imagem (sapatos achatados).
  - **Malha** (`core/src/mesh.ts`, pura):
    - pontos de borda na silhueta dilatada e internos com grade com jitter de semente (`rng.ts`, mulberry32), mais densos perto das articulações e da borda;
    - Delaunay (Bowyer–Watson); só ficam triângulos com o centróide e as arestas dentro da silhueta;
    - total ajustado por busca binária. neo: 584 vértices / 767 triângulos; smith: 638 / 891 (~170 ms).
  - **Pesos:**
    - distância geodésica (Dijkstra em Float64; com Float32 a busca parava cedo e todos os pesos viravam lixo), `1/(d+ε)³`, suavização Laplaciana, os 4 maiores, normalizados;
    - correntes de tecido: um fator de cor suave, testado numa vizinhança de 6 px (assim o contorno herda o tecido) contra todas as cores amostradas ao longo da corrente, espalhado pela malha.
  - **Render:**
    - `gl-skin.ts`: WebGL mínimo, LBS no shader com até 4 ossos e `uB[64]`, tint/alpha para flash e transições;
    - fallback Canvas 2D (`?gl=0`): triângulo a triângulo com afim e recorte crescido 1,2 px (sem fio);
    - `drawSkinDebug`: arame e calor do peso de um osso.
  - **Rig:**
    - `skinToRig` gera um `SolvedRig` com `kind: 'image'`, de modo que Skeleton, Animator, molas, IK e look-at são os mesmos;
    - matrizes de skinning = mundo × bind⁻¹;
    - as trilhas de slot e a pose nomeada (`"pose"` do clipe) são ignoradas na pose-imagem.
  - **API:**
    - `Character.load({ …, poses })`, `loadPose`, `addImagePose`, `setSkin('image'|'parts', {transition})`, `setPose(nome, {transition})`, com os actors seguindo (`onSkinChange`);
    - `Actor` tem um estado por skin/pose; na troca copia rotações e clipe pelo nome do osso e mantém posição, velocidade e raiz;
    - **transições:** `cut`, `flash` (4 frames), `afterimage` (10: cópias da pose antiga ficando para trás), `smear` (5: a nova esticada no sentido do movimento);
    - **âncora:** o pescoço da pose-imagem alinha com o do rig de peças, sem salto na troca;
    - **limites:** clampados por osso, membros ±12° e tecido ±25°;
    - **respiração** (`sy` 1 ± 0,012) na raiz.
  - **Demo:**
    - `?scene=skin&mode=rest|anim|debug&heat=&gl=0`;
    - `?scene=anim` usa a skin `image` por padrão, com o botão image ↔ parts, um seletor de transição e `&switch=t:skin:transição`;
    - Pose Lab `?scene=poselab&mode=image`: arrastar articulações (as coincidentes andam juntas), malha e pesos refeitos ao soltar, calor do osso, "Salvar esqueleto" (`/__sf/save` aceita `<pose>/<char>.skin.json`).
  - **Validação:**
    - (a) parado contra a referência: neo 0,01% dos pixels com diferença > 8 (média 0,04); smith 0,02% (média 0,03); fallback 2D 0,31% e 0,36%;
    - (b) 6 quadros do `idle_fly` nos dois personagens, sem rasgo ou dobra;
    - (c) debug com malha, ossos e calor;
    - (d) as 4 transições conferidas por screenshot;
    - **FPS** neste WSL sem GPU (WebGL por software, SwiftShader): WebGL 80–95, Canvas 2D 50–65, peças ~300;
    - 74 testes.
  - **Pendências:**
    - braços sobrepostos do smith (mão de trás) ainda podem ganhar `follow` se o usuário notar;
    - poses novas (dash, soco…) seguem o mesmo fluxo: recorte, esqueleto inicial no Pose Lab, salvar.
- **Plano revisado (2026-11-15):** as Fases 4–8 foram atualizadas para a abordagem `image` + biblioteca de poses (`parts` opcional), com escala normalizada pela cabeça, âncora no quadril, transições padrão smear/afterimage, ordem das poses da perseguição e WebP ≤ 200 KB.
- **Biblioteca de poses importada (2026-11-15):** 15 poses em estilo anime mais detalhado, em `assets/poses/code-call/`.
  - **Origem:** os PNGs ficam em `…/<pasta>/src/`. As imagens finais são `<pose>.webp` (1x, até 1024 px, 48–99 KB) mais `<pose>@2x.webp`, com o esqueleto em `<pose>.skin.json`.
  - **Índice:** `assets/skins/<char>.json` traz `default`, `dir` e `poses`.
  - **neo** (`neo/`): `fly` (nova, substitui a antiga da folha), `enter`, `look_back`, `punch`, `kick`, `hurt`.
  - **smith** (`smith/`; a pasta se chamava `vilain/` e foi renomeada para igualar o id): `fly`, `shoot`, `splat`, `fall`, `punch`, `punch_alt`, `kick` (era `vilain-kick`), `hurt_light`, `hurt_heavy`.
  - **CLI:**
    - `pose` grava WebP 1x/@2x e o índice com `--dir`;
    - **novo** `npm run atlas -- normalize --char <c>` recalcula o `scale` de cada pose pela altura da cabeça (`measure.headTop/chin` no `skin.json`) para igualar à `fly`.
    - A `fly` fixa a cabeça em 180 px no mundo nos dois personagens.
  - **Motor:**
    - o índice ganhou `dir`;
    - `image2x` é usada como textura só com DPR > 1,5 (malha e coordenadas sempre na 1x);
    - entre poses-imagem, a âncora é a da pose padrão (quadril na mesma posição).
  - **Malha:**
    - passo da borda adaptativo (~40% dos vértices no contorno: com passo fixo, as imagens grandes viravam leques finos e passavam de 1.300 vértices);
    - refinamento de cobertura: pixels visíveis sem triângulo ganham pontos, até 3 passadas (dedos, pontas de cabelo).
    - Resultado: 606–856 vértices por pose.
  - **Conferência:** repouso × imagem com no máximo 0,23% da figura diferente (pior caso: `fall` e `hurt_light`).
  - **Demo:** `?scene=skin&char=<c>&mode=strip` mostra todas as poses lado a lado na mesma escala, com a linha da altura da cabeça medida.
  - **Imagens para revisão:** `apps/demo/shots/out/review/` (debug por pose e tiras).
  - **Pendente:** conferência do usuário (escala e esqueletos podem ser ajustados no Pose Lab, `?scene=poselab&mode=image`).
- **Fase 4: concluída (2026-11-15).** Ações, golpes e contato, com poses-chave por golpe.
  - **Decisões do usuário:**
    - o agente (smith) ataca e atira; o neo **desvia** e vai até a porta;
    - a perseguição não acerta o neo; o contato com reação automática é validado numa cena de combo separada (`?scene=combo`).
  - **Tarefas 1 e 2** (já feitas na importação da biblioteca):
    - escala pela altura da cabeça, WebP ≤ 1024 px com aviso de 200 KB, @2x só com DPR > 1,5, âncora no quadril;
    - o cálculo virou função pura (`tools/atlas/src/normalize.ts`, com teste);
    - o Pose Lab em modo imagem ganhou **Escala da pose** (slider/número), com a pose base como fantasma ao lado e as linhas da altura da cabeça nas duas; "Salvar esqueleto" grava o `scale`.
  - **Poses provisórias:** ficam no índice `assets/skins/<char>.json`, em `"provisional": { "dodge": { "from": "fly", "rotate": -24, "sx": 0.92, "sy": 1.06, "dy": -10 } }`.
    - Usam a imagem e a malha de `from`, com rig próprio e a variação aplicada na raiz (`Actor.placeRoot`).
    - O debug marca "PROVISÓRIA ← fly" em laranja.
    - **neo:** `dodge`, `splat`, `fall`, `dash`. **smith:** `dash`.
    - Pose fora do índice e de `provisional` gera erro claro na carga.
  - **Core novo:**
    - `collision`: cápsula × cápsula (Ericson), círculo e cápsula × caixa (props);
    - `hurtbox`: o raio por osso do corpo é a mediana da meia-largura da silhueta em 5 pontos (tecido fica sem). É calculado em `assembleImagePose` (`ImagePose.hurtRadii`), e `hurtboxesOf` dá as cápsulas da pose atual;
    - `route`: subconjunto de SVG path com M/L/Q/C absolutos, amostrado por comprimento de arco;
    - `motion`: os controladores definem a **velocidade** (molas e squash reagem):
      - `MoveTo` (ponto ou rota, easing, `scaleTo` para a profundidade). É **aditivo**: segue o próprio ponto da rota, então a esquiva se soma em vez de ser desfeita;
      - `Impulse`/`dash`/`knockback` (arrasto exponencial), `Hover`, `Fall`;
    - `move`:
      - `parseMove`/`parseMoves` (fases `name, frames, pose, transition, clip, fx, camera, spawn, hitboxes{bone, radius, along}, run, motion{dash|offset|stop}, aim`, mais `onHit{hitstop, knockback, drag, stun, targetPose, targetTransition, targetClip, fx, camera}`);
      - `checkMovePoses`;
      - `MoveRunner`: sequenciador em frames de 60 fps, com hitboxes só na fase ativa e `onHit` uma vez por alvo por fase;
    - `actions`: `registerAction`, e as ações embutidas `teleport_behind`, `vanish`, `appear`;
    - `world`: `World`/`Fighter`.
      - Passo fixo, RNG com semente; `prepare()` carrega antes as poses dos golpes e os `targetPose` dos outros.
      - `perform` vira para o alvo só se o golpe ataca (hitbox ou projétil).
      - IK leve (`aim`) no braço da frente; projéteis saindo da ponta do osso (`spawn.from`) e mirando o centro do alvo.
      - Props com colisor de caixa (`hit:door->smith`, um por encostada).
      - Reação automática: `targetPose`, `targetClip`, knockback × direção do atacante, `stun` e volta à pose base (afterimage) com o `idle_fly`.
      - Eventos `hit`, `hit:a->b`, `phase`, `moveEnd`, `spawn`, `fx`, `camera`.
      - `fx`, `camera` e `hitstop` são só emitidos; a execução fica para a Fase 5.
    - `fight-draw`:
      - `drawProjectiles`: bala (risco) e rajada (bola de energia);
      - `drawFightDebug`: ossos, hurtboxes azuis, hitboxes vermelhas, props, e a etiqueta `id · image:<pose>`, PROVISÓRIA, golpe · fase · frame e reação.
  - **Mudanças:**
    - **transição padrão** de `setPose` sem `transition`: `smear` ao sair da pose base, `afterimage` ao voltar (`defaultTransition`). `setSkin` usa `smear`;
    - `Actor.opacity`, `face()`, `imagePose`, `poseName`;
    - **correção:** o fantasma da transição usava o esqueleto de desenho sem atualizar (num seek sem render aparecia gigante e sem espelhar). Agora ele é sincronizado com o último passo na troca.
  - **Golpes** (`assets/moves/<char>.moves.json`):
    - **smith:** `shoot` (pose shoot + aim + bala), `jab` (punch), `jab2` (punch_alt), `heavy_punch` (punch + avanço, lança com `knockback_spin`), `kick`, `dash_strike` (dash provisória → punch);
    - **neo:** `dodge` e `dodge_low` (provisória + `offset`), `jab`, `kick`, `energy_blast` (punch + rajada), `dash_strike`.
  - **Demo:**
    - `?scene=chase` (roteiro em TS; o JSON é da Fase 6):
      1. o neo foge por uma rota Bézier e o smith persegue;
      2. dois `shoot`. O neo desvia de cada bala que se aproxima (uma esquiva por bala, para o lado oposto ao da subida da bala);
      3. a porta surge, o neo entra (`enter`) e a porta fecha;
      4. `hit:door->smith` → `splat` (cut, rosto encostado na porta) → 0,4 s → `fall` com gravidade.
    - `?scene=combo`: `jab → jab2 → heavy_punch` (o próximo começa no `moveEnd`). Aceita `&combo=` e `&attacker=neo`.
    - Parâmetros comuns (`apps/demo/src/fight.ts`):
      - `&t=`;
      - **`&at=hit:N+F`**: para no N-ésimo contato mais F frames, o quadro exato do impacto (na URL, o `+` vai como `%2B`);
      - `&debug=1`, `&mesh=1`.
  - **Validação** (`npm run shots`, itens em `shots.json`, imagens abertas e analisadas):
    - **perseguição:** fly → shoot sem pulo, esquivas com PROVISÓRIA, `enter`, splat e fall;
    - **combo:** hurt em cada contato, lançado girando em `hit:3+14`; hitbox vermelha só na fase ativa, presa ao `hand_front` da pose atual;
    - `kick → dash_strike`, `energy_blast` do neo (o smith reage em `hurt_heavy`) e o Pose Lab com o fantasma;
    - **100 testes:** colisão, rota/movimento, formato e sequenciador de golpes, hurtbox, World (contato uma vez por fase, reação, determinismo, quadril sem pulo, transição padrão, provisória) e normalização de escala.
  - **Pendências / observações:**
    - **Fase 5:** hitstop, flash, faíscas e tremida, por enquanto só emitidos como eventos.
    - **Sobreposição:** com as imagens de perfil grandes, os corpos se sobrepõem bastante no contato corpo a corpo (o hurt do neo é encolhido). Vale ajustar a distância por golpe quando chegarem poses de soco de mais alcance.
    - **Âncora:** `actor.position` é a raiz do rig de peças (a âncora alinha o pescoço), não o quadril da imagem. Nas cenas, a posição dos props leva isso em conta.
    - **Hurtboxes** só existem nas poses-imagem; o rig de peças fica sem.
    - **Commits** continuam suspensos (pedido do usuário).
- **Manifestos, `pose:list` e genericidade (2026-11-15, a pedido do usuário):**
  - **Troca vilain → smith (feita antes, conferida):**
    - pastas `assets/poses/code-call/smith/` e `assets/sheets/smith-sheet-parts.png`, e o `dir` do manifesto;
    - **regra id = pasta** no CLAUDE.md, recusada com erro claro pelo CLI de poses e pela carga.
  - **Manifesto do personagem** (`assets/skins/<id>.json`, convertido nos dois personagens):
    - `character` (`name`, `description` visual, `style`, `styleRefs` com as imagens `src/` de estilo);
    - `poses` como objetos com `description` e `tags` (pt-BR, minúsculas);
    - `provisional` com `description` e `tags`.
    - As descrições foram escritas olhando as imagens e **ficam para o usuário revisar**.
    - `parseManifest` (core) é o único leitor. Aceita o formato antigo (lista de nomes) e valida nome repetido, provisória que já tem imagem, `from` inexistente, tag maiúscula e pasta ≠ id. É usado por `Character.load` (que guarda `character.manifest`) e pelo `tools/atlas`, que passou a depender do core pelo workspace.
  - **`npm run pose:list -- --char <id> [--provisional]`:**
    - tabela das poses (situação, arquivos, escala, descrição, tags);
    - para cada provisória: o **prompt de imagem pronto**, as imagens para anexar e os próximos comandos;
    - o prompt é montado só do manifesto por `imagePrompt()` (`tools/atlas/src/prompt.ts`): personagem + pose + estilo + regras fixas. É determinístico.
    - Situação atual: **neo** com 6 poses com imagem e 4 provisórias (dodge, splat, fall, dash); **smith** com 9 e 1 (dash).
  - **`npm run atlas -- pose`:**
    - aceita `--description`/`--tags`;
    - grava as poses no formato novo;
    - **tira a pose de `provisional`**, herdando a descrição e as tags;
    - cria um **esqueleto inicial** (o da pose base, redimensionado, com a medida da cabeça e a escala normalizada), só se ainda não houver `skin.json`.
    - O ciclo provisória → imagem foi testado numa cópia dos assets.
  - **Auditoria de genericidade:**
    - o core não tinha lógica específica de personagem, só nomes em comentários de exemplo (`skin`, `pose`, `world`, `character`, `validate`), agora trocados por `<id>`; os exemplos de uso do `tools/atlas` também;
    - **regra nova no CLAUDE.md** e teste `generic.test.ts`, que procura no `packages/core/src` todos os ids, nomes e pastas dos manifestos (e "vilain"). Foi conferido que ele falha com um nome inserido de propósito.
  - **106 testes** (manifesto, prompt de imagem, genericidade); build e demo (perseguição, combo, tiras) conferidos.
- **Fase 5: implementada (2026-11-15), aguardando a conferência do usuário.** Game feel e efeitos.
  - **Efeitos do personagem** (`Actor`, também em `fx.smear/afterimage/flash` da API de ações):
    - **smear** (`actor.smear(frames)`, padrão 3): borrão entre a pose que sai (congelada numa cópia do esqueleto) e a atual, esticado no sentido da velocidade (parado: pra frente). A atual entra **sólida**, esticada e vinda de trás, com 2 cópias de rastro; a antiga se estica pra frente e some por cima. **Toda troca não-cut passa por ele**: `smear` = só o borrão; `afterimage` = borrão + 3 cópias da pose que saiu ficando pra trás; `flash` = borrão de 2 + silhueta branca. Sem troca, vira borrão de movimento;
    - **afterimage** (`actor.afterimage({frames, every, life, alpha, tint})`): cópias translúcidas no mundo (uma por N frames durante `frames`). Usado no dash (`dash_strike`, azulado), no avanço do `heavy_punch`, na volta à pose base e no `teleport_behind`/`vanish`;
    - **flash** (`actor.flash(frames, cor)`): silhueta pintada; corre mesmo no hitstop;
    - **hitstop** (`actor.hold`): congela corpo, clipe, borrão e rastro; o alvo treme (± px alternando a cada 2 frames).
  - **World:**
    - **hitstop** do `onHit` executado: alvo (tremendo) e, no corpo a corpo, o atacante congelam N frames **em tempo real** (na câmera lenta o congelamento não se arrasta). A troca de pose de reação começa no contato e o borrão congela no 2º dos 3 quadros (a pose de reação já domina o quadro parado). A câmera continua (anda em tempo real);
    - `runFx(spec, {fighter, target, at, dir})`: tipos `impact, spark, muzzle, flash, afterimage, smear, shake, speedlines, slowmo, hitstop`, mais os presets genéricos `impact_small` (estrela pequena + flash 2 + trauma 0,28) e `impact_big` (estrela + anel + flash 3 + trauma 0,5 + linhas radiais). `fx` das fases e do `onHit` agora executam; tipo desconhecido só vira evento `fx` (ex.: `aura`);
    - `runCamera({shake, zoom, follow, pan, auto, frames|seconds})` para o `camera` dos golpes;
    - **câmera lenta por trecho**: `world.slowMotion(escala, s, rampa)` (simulação × escala; câmera e tremida em tempo real); `world.time` = tempo simulado, `world.realTime` = real;
    - `world.fxApi(self)` / `ActionContext.fx`: smear, afterimage, flash, impact, spark, speedLines, emit, run. `ActionContext.camera`: shake, zoom, pan, follow, auto.
  - **Câmera** (`camera.ts`, `CameraRig`, em passo fixo, determinística):
    - **auto** (padrão): enquadra os personagens visíveis (ou `targets`, que podem incluir props, ex. a porta), zoom pra caber com margem, suavizado; uma **restrição dura** no fim de cada passo garante que nenhum alvo sai do quadro, com folga para a tremida máxima;
    - `follow(id)`, `pan(x, y, s)`, `zoomTo(z, s)` (no auto vira o teto), `setAuto()`;
    - **tremida por trauma**: `shake(t)` soma trauma (≤ 1), decai 1,4/s, intensidade = trauma², ruído suave determinístico (`smoothNoise`) em x, y e giro (máx 34 px / 2°).
  - **Efeitos de mundo** (`fx.ts`, `Effects`, RNG próprio, não mexe no RNG da simulação): faíscas (riscos com arrasto e gravidade), estrela de impacto (pontas irregulares + núcleo + anel), clarão de cano (`muzzle` no tiro), **linhas de velocidade** lineares (atrás, no sentido do movimento) e radiais (concentração no ponto de impacto). Bala na porta solta faíscas.
  - **Paralaxe** (`parallax.ts`, `drawParallax`): camadas de imagem repetidas na horizontal, cada uma andando `factor` × a câmera (zoom ^ factor), com deriva própria. A demo gera céu, nuvens e três camadas de cidade com RNG de semente (`apps/demo/src/backdrop.ts`).
  - **Renderização** (o que foi preciso para 60 fps):
    - `renderer.prepare/drawPrepared`: no **WebGL** as cópias (borrão, afterimages) re-deformam a malha na GPU e saem numa **camada WebGL no DOM** (`useLayers`: canvas 2D do fundo, WebGL dos personagens, 2D da frente). Nada é copiado do WebGL para o canvas 2D (essa cópia era o passo caro: ~8 ms por sincronização). Fora das camadas, `batch()` compõe uma vez só, recortada na caixa dos personagens;
    - no **Canvas 2D**: triângulos por **padrão de textura** (um `fill`, sem `clip`/`save`), e os que um osso dominante sozinho leva a < 1 px da deformação saem num preenchimento por osso (de ~1.000 operações para poucas centenas); todos crescem 1,2 px (sem emenda). Com cópias, a pose vira um sprite capturado uma vez (as cópias são `drawImage`); sem cópias, vai direto na tela;
    - `renderer.preload(character)` sobe/decodifica as texturas das poses na montagem (sem engasgo na primeira troca); MSAA do WebGL desligado (a borda vem do alfa da textura);
    - câmera com giro (`Camera.rotation`), `screenToWorld` pela inversa da vista.
  - **Golpes:** `dash_strike` com afterimage azulado + linhas de velocidade na arrancada; `heavy_punch` com afterimage no avanço.
  - **Demo:** perseguição e combo com câmera automática, paralaxe e linhas de velocidade; no combo, o `heavy_punch` entra em câmera lenta (×0,3 por 0,9 s; `&slow=0` desliga); na porta, um impacto só, com hitstop de 9 frames. HUD: renderizador, HITSTOP, câmera lenta, fps e custo do quadro. Parâmetros novos: `&at=pose:<id>:N±F`, `&at=hit:N-F` (antes do contato, re-simulando), `&perf=1`, `&only=`, `&layers=0`.
  - **Validação:**
    - `node apps/demo/shots/seq.mjs`: sequências **quadro a quadro** (60 fps) em folhas de contato (`apps/demo/shots/out/seq/`): fly→shoot e shoot→fly, esquiva e volta do neo, porta (splat), splat→fall, jab (pose e contato), jab2, heavy_punch (24 quadros, câmera lenta), volta à fly, dash_strike e as mesmas com `&gl=0`;
    - `node apps/demo/shots/perf.mjs` (`GPU=1`: navegador com janela usando a GPU; no WSL, Iris Xe via WSLg/D3D12; o headless só tem SwiftShader). Resultado (3 repetições, 1280×720), custo no thread principal (simulação + desenho) e fps:
      - WebGL: 0,9–1,3 ms em média, p95 ≤ 2,7 ms, nenhum quadro acima de 16,7 ms; 55–60 fps;
      - Canvas 2D: 1,8–2,7 ms em média, p95 ≤ 5,9 ms, no máximo 1 quadro acima de 16,7 ms; 56–60 fps;
      - só o fundo: 60 fps. As perdas restantes caem em instantes aleatórios (sem relação com trocas de pose ou impactos): oscilação do ambiente;
    - 116 testes (novos: ruído/trauma, câmera nunca corta alvo em disparada com tremida, pan/zoom/seguir, efeitos determinísticos, hitstop congela atacante/alvo/borrão com a câmera andando, câmera lenta, borrão em toda troca não-cut, afterimage).
  - **Pendências / observações:**
    - commits continuam suspensos (pedido do usuário);
    - em headless (SwiftShader, GPU por software) o WebGL fica em ~35–58 fps: o limite é a GPU emulada (o custo no thread principal é de 1–2 ms);
    - **fx aura sem desenho (energy_blast do neo).** Até ter desenho, o `energy_blast` funciona sem a aura: o tipo `aura` não executa nada além do evento `fx` (carregar → soltar a rajada → contato com `impact_big`/`flash` seguem normais).
- **Fase 6: implementada (2026-11-16), aguardando a conferência do usuário.** Diretor de cena (roteiro).
  - **Formato** (`packages/core/src/script.ts`, `parseScript`, `checkScript`, `scriptSchema`):
    - `{ title, seed, duration?, tail, cast: { <id>: { at, scale, facing, pose, clip, opacity, collideProps } }, camera, steps[] }`; aceita também só a lista de passos. A ordem do `cast` é a ordem de desenho;
    - passo `{ id?, at | after | on, nth?, delay?, actor?, do, params }`: exatamente um gatilho; `after` = quando o passo citado **terminar**; `on` = n-ésima ocorrência de um evento (`nth`, padrão 1); `delay` soma nos três;
    - eventos: `hit` / `hit:<a>-><b>` (a pode ser prop), `incoming:<dono>-><alvo>` (projétil chegando, novo no World, `incomingDistance` 620 px), `spawn:<dono>`, `moveEnd:<id>`, `start:<passo>`, `done:<passo>`;
    - comandos (tabela `COMMANDS`, que gera o validador **e** o JSON Schema): `pose`, `move`, `moveTo` (ponto ou rota, `relative`, `scaleTo`), `dash`, `hover`, `fall`, `face`, `play`, `camera` (auto/follow/pan/zoom/shake/targets/snap), `fx` (os tipos e presets dos golpes; num passo `on` sai no ponto do evento), `spawnProp`, `prop` (ação do tipo ou `remove`), `enter`, `touch`, `opacity`, `say` (balão), `wait`, `parallel` (filhos com `delay`, herdam o ator; termina quando todos terminam);
    - validação com caminho do campo e o que é aceito: comando/parâmetro desconhecido, obrigatório, enum, gatilho duplo, `after` inexistente ou em ciclo, id repetido, evento mal formado, id fora do elenco/props. `checkScript` confere poses (inclusive provisórias), golpes, clipes, efeitos e tipos/ações de prop contra os personagens carregados.
  - **Diretor** (`director.ts`, sem navegador): `Director.create(json, { characters: { <id>: { character, moves } }, clips })` valida, carrega as poses citadas (e as dos golpes), mede a duração (fim do último passo + `tail`; `on` que nunca dispara aparece em `unfired()`).
    - Passo fixo de 120 Hz sobre o World; fila de ativações ordenada por (tempo, ordem); passos instantâneos encadeiam no mesmo passo.
    - `play/pause/advance(dt)` (com `timeScale`), `seek(t)` = recria atores e World e re-simula do início em silêncio; `progress`, `duration`, `loop`; eventos repassados do World + `step` (início/fim) + `end`.
  - **API fluente** (`script-builder.ts`): `script({…}).cast(…).at(0).actor('<id>').moveTo(rota, 2.2).as('fuga').then().pose(…).on('hit:…').parallel(p => …)`. Gera o **mesmo JSON** e passa pelo mesmo `parseScript`. Comandos seguidos sem gatilho novo começam juntos; `then(delay)` encadeia no último; `actor(null)` para comandos sem ator.
  - **Props** (`props.ts`): `registerProp(type, { states, solid, actions, draw })`; `door` (surge crescendo do centro e acendendo, fecha com a folha girando na dobradiça, fica sólida só no fim da animação) e `wall`. Estado no `Prop` do World (`state/previous/changedAt/changeTime/bornAt/appear`).
  - **Clip-path de "entrar"**: `renderer.hide` (quadrilátero convexo no mundo) esconde o que o personagem desenha ali; no WebGL é `discard` no shader (4 retas em px do buffer), no Canvas 2D é `clip('evenodd')`. O `enter` esconde tudo além do plano no meio da porta, na altura dela; ao terminar, o ator fica com opacidade 0.
  - **`Scene`** (`scene.ts`, navegador): `Scene.create(canvas, { characters, clips, parallax, drawBackground, drawOverlay, webGL, layers, debug })`, `load(url | json)`, `play/pause/seek`, `time/duration/progress/loop/timeScale`, `on(evento)`, `render()`. Desenha paralaxe, props, personagens (com o recorte), projéteis, efeitos e balões.
  - **Perseguição** (`assets/scenes/chase.json`): só roteiro e APIs públicas; o `chase.ts` antigo (lógica em TS, esquiva calculada pela bala) foi apagado. A esquiva virou `on: incoming:smith->neo` (nth 1 e 2), a reação à porta virou `on: hit:door->smith` → `parallel` (hover, `splat` cut, `touch` na porta, clipe, `impact_big`, hitstop 9) e `after: splat` + 0,4 s → `fall`. A versão pela API fluente fica em `apps/demo/src/chase-api.ts` (teste garante roteiro igual).
  - **Demo:** `?scene=chase` e `?scene=script&file=scenes/<x>.json` (cena genérica: o elenco vem do roteiro). Parâmetros: `&t=`, `&from=A&t=B` (seek para A e volta para B), `&play=` (avança quadro a quadro, sem seek), `&at=hit:N±F` / `pose:<id>:N±F`, `&api=1`, `&debug=1`, `&gl=0`, `&perf=1`. Ao vivo: tocar/pausar, barra de tempo (seek), câmera lenta, laço.
  - **Validação:**
    - perseguição comparada lado a lado com as capturas da versão antiga em 0,5–3,5 s (mesma estrutura: fuga, dois tiros com esquiva PROVISÓRIA, porta, entrada recortada, splat, fall);
    - **seek determinístico:** em 0,9 / 1,6 / 2,62 / 3,3 s, as quatro formas de chegar (seek direto, seek vindo de 4,2 s, seek vindo de 0,3 s e tocando quadro a quadro) dão PNGs idênticos (mesmo md5); a versão da API fluente também;
    - **132 testes** (novos: formato e mensagens de erro, `checkScript`, schema, API fluente ≡ JSON, diretor: at/after/delay, duração e `end`, `on` + `incoming` + nth, `unfired`, parallel, porta sólida no fim e `touch`, `enter`, seek ≡ tocar);
    - `MoveTo` agora termina com tolerância de 1e-9 (n × dt ficava abaixo da duração e terminava um passo atrasado).
  - **Pendências / observações:**
    - `expression` e `hand` (do plano) não entraram: só existem como trilhas de slot no rig de peças, e as poses-imagem não têm slots;
    - **desempenho a remedir:** hoje o ambiente estava lento (o combo, código inalterado, deu 16 fps com GPU). Na mesma medição a perseguição por roteiro custou 3,5–6 ms por quadro no thread principal, sem regressão contra o combo;
    - commits continuam suspensos (pedido do usuário).
- **Pós-Fase 6 (2026-11-16), a pedido do usuário:**
  - **Variantes de textura** (`<pose>@<variante>`, ex.: `shoot@nogun`):
    - **manifesto:** `poses[].variants: [{ name, kind: "expression" | "hand", description, tags }]`; nomes `2x` e `none` são reservados. Os arquivos ficam em `<dir>/<pose>@<variante>.webp` (+ `@2x` se a pose tiver) e a fonte em `src/<pose>@<variante>.png`;
    - **core:** `buildVariant(base, nome, imagem, rgba)` reusa esqueleto, malha, pesos e rig da base e troca só a imagem. Tamanho diferente é erro; `silhouetteDiff` mede a diferença de silhueta e o deslocamento do centro, com aviso acima de 3 % (`VARIANT_SILHOUETTE_WARN`);
    - `Character.loadVariant` / `variantsOf` / `posesWithVariant` / `onWarning`;
    - `Actor.setVariant(kind, nome | null)` vale em toda pose que tem a variante, e a última escolhida tem prioridade; a imagem é escolhida em `variantPose`. O renderer aceita a pose explícita (`prepare(…, variant)`), tanto no WebGL quanto no Canvas 2D;
    - **roteiro:** os comandos `expression` e `hand` (`{ name }`, `"none"` volta à imagem da pose). Se a pose atual não tem a variante, ela fica como está e sai um aviso (`Director.warnings`, evento `warning`, `onWarning`). Variante que não existe em pose nenhuma gera aviso na carga. A simulação seca que mede a duração já acusa esses avisos. API fluente: `.expression()` e `.hand()`;
    - **`npm run pose:add`** (novo, `tools/atlas/src/add.ts`):
      - sem `--variant`: recorta e cria a pose (`atlas pose`), normaliza e imprime as URLs de conferência;
      - com `--variant <nome> --kind expression|hand`: recorta a fonte **com a caixa da figura da pose base** (refeita a partir de `src/<pose>.png`) ou aceita a variante já no tamanho final. Confere a silhueta e registra no manifesto.
      - O manifesto passa a ser gravado com uma pose por linha (`formatManifest`).
      - O recorte virou `cutFigure` (refactor conferido: `shoot.webp`/`@2x` saem byte a byte iguais).
    - **catálogo do narrador** (`tools/narrator`, só o catálogo, sem dependências novas): `buildCatalog(assets)` com personagens (poses com variantes, provisórias com `from`), golpes (poses, duração, tipo de ataque, `targetPose`), clipes, efeitos, props, ações, transições, comandos e eventos. A saída é estável. Imprimir: `npm run narrate -- catalog`. O resto da Fase 6.5 (chamada à API) continua pendente e precisa da confirmação das dependências;
    - **demo:** `?scene=variants&char=<id>` mostra a base, a variante (pela malha da base) e as silhuetas sobrepostas com a %; `scenes/variantes.json` exercita `hand`/`expression`, com os avisos no HUD;
    - **`shoot@nogun` (smith) é uma imagem de TESTE:** foi feita apagando a pistola de `src/shoot.png` (2,2 % de diferença de silhueta). Para trocar pela imagem definitiva: `npm run pose:add -- --char smith --pose shoot --variant nogun --src <png> --replace`;
    - `World.prepare`: com um personagem só em cena, não exige mais a pose de reação dos golpes em "outro personagem".
  - **Recuo antes da queda (perseguição):** `after: splat` + 0,4 s → `moveTo` relativo `[-40, 0]` em 0,18 s com `backOut` (passo `recuo`) → `fall`. Com 36 px a cabeça ainda encostava na borda no 2º quadro da `fall`; com 40 px ela para antes da porta.
  - **Profiler** (`node apps/demo/shots/profile.mjs <cena> <s>`, `GPU=1` para a GPU real): perfil de CPU (tempo próprio por função) e timeline por thread, via CDP, o mesmo do painel Performance do DevTools; os arquivos `.cpuprofile` e `.trace.json` ficam em `shots/out/profile/`.
    - **O gargalo não está no nosso código.** O JS da cena custa ~1 ms/quadro (simulação 0,5 + desenho 0,5); a função mais cara é `Actor.bounds` (~0,2 ms/quadro, deforma a malha para a câmera).
    - **GPU real (WSLg, Iris Xe via ANGLE/D3D12), ~49 fps:** o processo da GPU fica ocupado ~16 ms/quadro, dos quais ~10 ms em `RealSwapBuffers` (apresentar o quadro). Um quadro **vazio** (só limpar) já custa 11 ms ali (swap 7,3 ms). A cena acrescenta ~5 ms: troca de contexto do WebGL (`MakeCurrent` +0,8), swap +2,6 e raster do canvas 2D +2. Sem céu e sem paralaxe muda pouco (15,8 ms). Compor o WebGL no 2D (`layers=0`) piora (19,2 ms), e só Canvas 2D (`gl=0`) também (20,8 ms).
    - **Headless (SwiftShader), 55–60 fps:** a thread principal fica perto do limite com `Commit` (~9–10 ms) e espera síncrona pela GPU (`WaitForGetOffset`, ~4,4 ms), tudo do caminho de GPU por software.
    - **Pendência:** medir fora do WSL (navegador nativo do Windows). Se o swap continuar alto, a alavanca é reduzir as camadas de tela cheia (hoje são três: fundo 2D, WebGL e frente 2D).
- **Fase 6.5: implementada (2026-11-16) sem nenhuma IA paga, aguardando a conferência do usuário.** Narrativa → roteiro.
  - **Decisão do usuário (2026-11-16):**
    - nada de API paga nem de chave: o `@anthropic-ai/sdk` foi **desinstalado**;
    - saíram o `.env.example`, o endpoint (`narrate:serve`), a chamada ao Claude, o schema de saída estruturada e o histórico de conversa;
    - quem escreve a cena é o Claude Code, pelo comando `/narrate` (`.claude/commands/narrate.md`).
  - **`tools/narrator`** (só ferramentas determinísticas, deps: sharp, vite, playwright; `npm run -s narrate -- …`):
    - `catalog`;
    - `validate <cena>`: formato, nomes, poses pendentes/provisórias (inclusive as que entram por golpes), coerência com o arquivo lateral, simulação seca (duração, `on` que nunca dispara, `expectations`, cena sem fim, ator fora do quadro) e avisos; saída ≠ 0 com erro;
    - `missing <cena>`: grava as provisórias declaradas e gera `scenes/<nome>.missing.md` com os prompts do manifesto e os `pose:add`, incluindo variantes (`variantPrompt`, novo no `tools/atlas`) e esqueletos de golpe; `--no-provisional`;
    - `preview <cena>`: tempos-chave pela simulação seca, screenshots pela demo e `contato.png` com o que acontece em cada quadro; `--times`, `--debug`.
  - **Arquivo lateral** `scenes/<nome>.narrative.json` (narrativa, `poseMap`, `missing`, `expectations`, `assumptions`; `narrative.ts`). O roteiro fica no formato do motor.
  - **`NarratorProvider`** (`provider.ts`): só a interface, para um modelo local via Ollama no futuro.
  - **Core:** o evento `step` do diretor passou a levar `params` (rótulos da prévia); `Character.loadImagePose` ficou público (carga em Node).
  - **Testes com o `/narrate`** (os passos do `.claude/commands/narrate.md` seguidos à mão, nesta sessão):
    - **"o agente persegue o neo pelos telhados, atira duas vezes, o neo desvia e some numa porta; o agente bate de cara e cai"** → `scenes/perseguicao-telhados.json` + `.narrative.json`:
      - `poseMap` todo `exact`; validate OK (`hit:door->smith` ×1);
      - aviso da provisória `dodge` (entra pelo golpe), com o prompt dela no `.missing.md`;
      - a prévia mostrou o fim com o agente caindo abaixo da cidade e a câmera aberta demais; corrigido com `tail` 0,55 s e conferido de novo.
    - **"o neo dá um chute giratório"** → `scenes/chute-giratorio.json`:
      1. o validate acusou `kick_spin` pendente;
      2. o `missing` gravou a provisória `kick_spin ← kick` no manifesto do neo e o prompt de imagem com o `pose:add`;
      3. validate OK; a prévia mostra PROVISÓRIA ← kick.
      - O passo "depois do `pose:add`, a mesma cena roda sem a marca" já tinha sido conferido numa cópia dos assets com uma imagem de teste (o mecanismo não mudou).
  - **148 testes:** arquivo lateral, validate → missing → validate, `--no-provisional`, coerência, variante e golpe que faltam, provisória por golpe, evento esperado, tempos-chave.
  - **Ajuste (2026-11-16, a pedido do usuário):** no `poseMap`, poses provisórias aparecem com `match: "provisional"` e `from`.
    - O `validate` recusa `exact`/`similar` numa provisória, e `provisional` numa pose que não é provisória ou com o `from` errado.
    - O `missing` converte `missing` → `provisional` (idempotente).
    - As duas cenas de teste foram corrigidas: `neo/dodge provisional ← fly` e `neo/kick_spin provisional ← kick`.
  - **Pendências:**
    - gerar as imagens de `dodge` e `kick_spin` (prompts nos `.missing.md`);
    - o slash command só roda quando digitado pelo usuário (`/narrate …`); nesta sessão os passos foram seguidos à mão.
- **Fase 7: implementada (2026-11-16), aguardando a conferência do usuário.** Angular.
  - **Pacotes:** Angular 22.2 + ng-packagr 22.2 (dev deps na raiz; zone.js no exemplo). `angular.json` na raiz com dois projetos:
    - `ngx-sprite-fighter` (`packages/angular`, builder `@angular/build:ng-packagr`, saída em `packages/angular/dist`);
    - `ng-example` (`apps/ng-example`, porta 4300). Ele importa a lib **pelo pacote gerado** (`paths` → `packages/angular/dist`) e serve só os assets que usa (skins, poses sem `src/`, moves, clips, scenes).
    - Scripts: `npm run build:ng` (também entra no `npm run build`), `npm run ng:start`, `npm run ng:check`.
  - **`<sf-scene>`** (`packages/angular/src/lib/sf-scene.ts`, README do pacote):
    - inputs `characters`, `script`, `clips`, `autoplay`, `loop`, `debug`, `timeScale`, `webgl`, `playOnVisible`, `parallax`, `background`, `overlay`;
    - outputs `(ready)`, `(step)`, `(hit)`, `(end)` e `(loadError)`; métodos `play/pause/seek` e leitura de `time/duration/playing/scene`;
    - `loop`, `timeScale` e `debug` mudam ao vivo. Trocar elenco, roteiro, clipes, `webgl` ou cenário remonta a cena; uma carga antiga é descartada (contador de geração).
    - **Camadas:** o canvas do cenário fica embaixo, com a camada WebGL e a 2D da frente do renderer por cima, no host (`position: relative`, `aspect-ratio: 16/9` padrão). O `ResizeObserver` e o DPR (`matchMedia`, refeito a cada mudança) redimensionam as três juntas.
    - **Zona:** o `play()` agenda o rAF dentro de `runOutsideAngular`; os observers são registrados fora da zona; os outputs entram na zona só ao emitir.
    - **`playOnVisible`:** usa `IntersectionObserver` com 50 %. Toca ao entrar e pausa ao sair; se a cena já tinha terminado, recomeça. Um `pause()` explícito desliga a retomada.
    - **Destruir:** `Scene.destroy()` mais o fim dos observers e do `matchMedia`.
  - **`SfAssets`** (root): cache por URL de personagens, golpes, clipes e roteiros. Uma carga que falha sai do cache.
  - **Core (mudanças da fase):**
    - `Character.load({ poses })` carrega **só com poses-imagem** (id = nome do manifesto). O rig do personagem é o da pose padrão, e `hasParts` é false (`setSkin('parts')` dá um erro claro). A âncora fica no quadril (0). Por isso o resultado sai ~5 px deslocado em relação à carga com atlas+rig, que alinha o pescoço com o rig de peças: os mesmos contatos acontecem nos mesmos instantes. Os carregadores de pose/variante viraram `poseLoaders`, compartilhados pelos dois modos;
    - `ActorOptions.pose`: o `Director.reset` cria cada actor já na pose do elenco e **não mexe mais na pose do Character**. Isso permite um mesmo Character (do cache) em duas cenas ao mesmo tempo (teste novo);
    - `GLSkinRenderer.dispose()` (buffers, texturas, shaders, programa, `WEBGL_lose_context`), `CanvasRenderer.dispose()` (GL, camadas do DOM, bitmaps de rascunho), `Director.dispose()` e `Scene.destroy()`/`isDestroyed`. O laço também aguenta destruir a cena dentro de um ouvinte;
    - `Scene.resize(w, h, dpr?)`, `Scene.load(json, nome?)` (nome nas mensagens de erro) e o tipo `StepEvent` exportado.
  - **App de exemplo:** rotas `/` (sem cena), `/perseguicao` (`scenes/chase.json` com a cidade em paralaxe copiada da demo, autoplay, tocar/pausar, recomeçar, câmera lenta, laço, debug, barra de tempo atualizada fora da zona, registro de passos e contatos) e `/chute` (`scenes/chute-giratorio.json` abaixo da dobra, com `playOnVisible` e laço).
  - **Validação** (`node apps/ng-example/shots/check.mjs`, com o app rodando; instrumenta rAF, getContext, observers e matchMedia antes da página):
    - screenshots em `apps/ng-example/shots/out/`: perseguição ao vivo e em 0,9 / 1,6 / 2,62 / 3,3 s, chute ao vivo e em 0,62 s. Comparados com a demo no mesmo tamanho: mesma sequência (tiro, entrada recortada na porta, splat com estrela de impacto), com o deslocamento de ~5 px da âncora;
    - **fora da zona:** em 1 s tocando, os 118 callbacks de rAF rodaram na zona `<root>`, com 3 detecções de mudanças, uma para cada um dos 3 eventos `step`;
    - **sair da rota** (perseguição → início e chute → início): 0 rAF/s, contexto WebGL perdido (`isContextLost`), 0 observers, 0 ouvintes de `matchMedia`, 0 canvas no DOM;
    - **`playOnVisible`:** fora da tela fica parada em t = 0; ao rolar até a cena, toca; ao rolar para longe, pausa;
    - **tamanho/DPR:** com DPR 1 e 2, as três camadas têm sempre o mesmo buffer (CSS × DPR) antes e depois de estreitar a janela; a @2x só é baixada com DPR 2;
    - 150 testes; `npm run build` passa (inclui a lib e o exemplo).
  - **Pendências / observações:**
    - trocar de DPR cruzando 1,5 não troca as texturas já carregadas (1x ↔ @2x): só redimensiona;
    - o `webgl=false` usa o caminho Canvas 2D de sempre (uma camada só), mas não foi capturado no exemplo;
    - commits continuam suspensos (pedido do usuário).
- **Fase 8: implementada (2026-11-16), aguardando a conferência do usuário.** Documentação e acabamento.
  - **`README.md`** (pt-BR, raiz):
    - instalação, uso no Angular (`<sf-scene>`: inputs, outputs, métodos) e uso sem framework (`Scene`, API fluente, `Director` em Node);
    - formatos: manifesto, `skin.json`, golpe e roteiro (gatilhos at/after/on, eventos, todos os comandos, efeitos, easings, clipes);
    - guias "novo personagem", "nova pose", "nova variante", "novo golpe" e "nova cena" (à mão, pelo `/narrate`, o ciclo das poses que faltam e a prévia);
    - ferramentas, demo e parâmetros, orçamento, limites conhecidos e o apêndice do rig de peças.
  - **Bundle do core** (`npm run size`, novo: Vite minificado + gzip 9):
    - a lib inteira dá **53,9 KB**; o uso típico (`Scene` + `Character` + parsers) dá **50,7 KB**;
    - **acima do orçamento de 40 KB, e não corrigido**: o peso é o próprio player (roteiro e validação 5,4 KB, World 4,8, renderer 4,6, Director 4,3, Actor 4,0, malha 3,8). As strings de doc do roteiro somam só ~1,3 KB, então não há corte barato.
    - **Decisão pendente do usuário**, entre três opções:
      - gravar malha e pesos no `skin.json` pelo CLI;
      - separar o que é só de autoria num ponto de entrada próprio;
      - separar o rig de peças.
  - **Teste do guia "novo personagem"**: feito do zero, numa cópia dos assets (`SF_ASSETS`), com um 3º personagem de teste (`rival`: PNGs do smith recoloridos e reduzidos), seguindo o README ao pé da letra.
    - **O que faltava ou estava quebrado e foi corrigido:**
      - **primeira pose sem esqueleto:** o Pose Lab não abre uma pose sem `skin.json`. Agora há `pose:add … --skeleton <outro-id>`, que copia o esqueleto da pose base de outro personagem, redimensionado para a figura e com a cabeça do mesmo tamanho no mundo. Sem a opção, a saída diz como fazer;
      - **manifesto primeiro:** uma pose em `poses` ainda sem `.webp` aparece no `pose:list` como "SEM IMAGEM", com o prompt (e a dica do `--skeleton` na base), e o `pose:add` aceita a pose sem `--replace`;
      - **demo presa a neo/smith:** os personagens vêm dos manifestos (`GET /__sf/characters` no servidor de dev). Quem não tem atlas + rig carrega só com poses; os golpes são opcionais (o Vite responde `index.html` com 200 para arquivo que não existe, e isso agora conta como "sem golpes"); o modo peças do Pose Lab e o `?scene=rig` recusam com mensagem clara;
      - **narrador (Node) exigia atlas + rig:** agora usa `Character.fromPoses(manifesto, carregadores)`, novo e público no core, que também serve ao navegador;
      - **"Salvar esqueleto" do Pose Lab era recusado** (`caminho não permitido: poses/<coleção>/<id>/<pose>.skin.json`): o filtro do servidor não aceitava `.skin.json`. Corrigido; o arquivo é gravado com um osso por linha, igual ao CLI;
      - **medida da cabeça arrastável no Pose Lab:** dois quadrados amarelos, e a escala acompanha (a cabeça no mundo não muda). O passo "rode `normalize` depois", que desfaria um ajuste manual da escala, saiu do prompt;
      - **Pose Lab:** a vista inicial cabe na tela; o botão "Modo peças" some para quem não tem peças;
      - **CLIs de pose:** respeitam `SF_ASSETS` (como a demo e o narrador; o `missing` do narrador também). Erro sai como mensagem curta, sem stack. URLs de conferência completas. Aviso quando o manifesto não tem `character`;
      - **`validate`:** a falta do arquivo lateral numa cena escrita à mão é explicada como normal.
    - **No próprio README**, pegos pelo teste literal:
      - o exemplo de golpe tinha comentário `//` (quebra quem copia);
      - a cena de teste do golpe não dava contato;
      - a API fluente estava com as assinaturas erradas;
      - o exemplo de mensagem de erro foi trocado por uma real.
    - Conferido também: remover à mão ossos de tecido e a corrente (com erro claro se a corrente ficar), a cena só com o personagem novo, golpe + `at=hit:1` com debug, variante (`--variant`), `missing` e `preview`.
    - **Os assets reais não foram tocados.**
  - **152 testes** (2 novos: a primeira pose com `--skeleton` e sem ele); `npm run build` passa; demo dos personagens existentes sem regressão (perseguição, rig, Pose Lab nos dois modos, anim, variantes).
  - **Pendências:**
    - a decisão do bundle;
    - medir o desempenho num navegador nativo do Windows;
    - ações TS próprias não existem para o `narrate validate` (só as embutidas);
    - commits continuam suspensos (pedido do usuário).
- **Pós-Fase 8 (2026-11-17), a pedido do usuário:**
  - **Entrada `sprite-fighter/authoring`** (`packages/core/src/authoring.ts`; `exports` no `package.json`; aliases no Vite da demo e no Vitest):
    - **o que foi para lá:**
      - conferência detalhada (`checkScene`, `checkScript`, em `script-check.ts`), que saiu do `Director.create`;
      - JSON Schema e as descrições dos comandos (`scriptSchema`, `COMMAND_DOCS`, em `script-docs.ts`). A tabela `COMMANDS` do player ficou só com tipos e obrigatórios; um teste garante que as duas têm os mesmos comandos e parâmetros;
      - API fluente (`script(...)`);
      - debug (`drawFightDebug`, `drawSkinDebug`, em `debug.ts`; o `drawSkinDebug` deixou de ser método do renderer);
      - `Reader`.
    - **Player:**
      - `Scene` recebe o debug por injeção (`debug: drawFightDebug`, tipo `DebugDraw`);
      - nome errado agora falha com mensagem clara no ponto de uso: clipe (`World.clip`) e tipo ou ação de prop davam `TypeError`; pose e golpe já tinham mensagem; efeito desconhecido continua virando evento.
    - **Angular:** o `debug` do `<sf-scene>` faz `import()` de `sprite-fighter/authoring` só quando liga. É um chunk preguiçoso de 1,3 KB, conferido: 0 requisições antes, 1 depois.
    - **Demo e narrador:** a demo confere a cena com `checkScene` antes de tocar; o narrador usa `checkScene` e `COMMAND_DOCS`.
  - **Bundle** (`npm run size`, que agora mede o player, o uso típico e quanto a autoria acrescenta):
    - player 53,9 → **49,5 KB** gzip; uso típico 47,8 KB; autoria +4,8 KB;
    - **orçamento novo: 54,5 KB** (o medido + 10 %), conferido pelo script (saída ≠ 0 acima dele);
    - **imagens:** as das poses dominam (perseguição ~480 KB em WebP 1x; biblioteca ~1,1 MB em 1x + ~1,0 MB em @2x).
    - **Não feitas, por decisão do usuário:** malha e pesos gravados no `skin.json`, e rig de peças separado.
  - **`sf.actions.json`** (na raiz do projeto que usa a lib; `[{ name, description?, params?: { <nome>: <descrição> } }]`):
    - **Golpe:** `run` aceita `"<ação>"` ou `{ "action", "params" }`, e os parâmetros chegam em `ActionContext.params`.
    - **Narrador** (`tools/narrator/src/actions.ts`):
      - o `validate` confere o `run` dos golpes do elenco. Uma ação **declarada** passa, e parâmetro não declarado é erro. Uma ação **desconhecida com o arquivo** é erro (o arquivo é a lista completa); **sem o arquivo**, é aviso;
      - nos três casos, a simulação seca usa uma ação vazia no lugar;
      - o `preview` faz o mesmo nos tempos-chave;
      - o `catalog` lista as embutidas e as declaradas (`actions: { <nome>: { builtin, description, params } }`).
    - **Demo (prévia):** `GET /__sf/actions` lê o arquivo; toda ação não registrada vira vazia, com aviso no HUD.
    - **`/narrate`:** usa as ações do catálogo e não inventa ação.
    - Conferido pelo CLI numa cópia dos assets, nos três casos (sem arquivo, com arquivo, arquivo sem a ação), mais a prévia.
  - **158 testes** (novos: `COMMAND_DOCS` ≡ `COMMANDS`, ação com `params` no World, `sf.actions.json` em 4 casos); `npm run build` passa; regressão visual da demo (debug injetado, API fluente, malha, Pose Lab) e do exemplo Angular (debug preguiçoso).
  - **Observação:** o defeito do instante 0 foi corrigido logo depois (ver abaixo).
- **Correção do instante 0 (2026-11-17), a pedido do usuário:** a cena nascia sem enquadrar.
  - **Causa:** antes do primeiro passo, a câmera estava em (0, 0, zoom 1), e **os atores também**: o esqueleto da simulação só recebe posição, escala e lado no passo, e o desenho usava o esqueleto na origem, em escala 1. Daí o personagem enorme.
  - **Correção:**
    - **atores:** `Actor.settle()` põe o esqueleto no estado atual (posição, lado, escala, pose e clipe no instante atual, limites e `follow`) sem andar o tempo (sem mola, squash ou rastro);
    - **câmera:** `CameraRig.frame()` e `World.frameCamera()` põem a câmera direto no enquadramento-alvo, sem suavizar, e zeram a interpolação;
    - **onde roda:** o `Director.reset` (início, `seek`, recomeço) chama os dois. Mudar o tamanho da vista em t = 0 reenquadra (igual a um reset com o tamanho novo). A suavização segue só entre passos consecutivos.
  - **Conferido:**
    - demo: `&t=0` igual a `&from=2&t=0` (mesmo md5) e com o mesmo enquadramento de 0,05 s. O determinismo continua: `t=1.6`, `play=1.6` e `from=3.2&t=1.6` dão o mesmo md5;
    - Angular: o chute com `playOnVisible`, carregado abaixo da dobra e parado em t = 0, sem rolar, sai enquadrado; a perseguição tocada até ~1,1 s, pausada e levada a 0 pela barra (`seek(0)`) também.
    - **Atenção:** o servidor de dev do Angular guarda o `sprite-fighter` pré-empacotado em `.angular/cache`; depois de reconstruir o core, ele continua servindo a versão antiga até o cache ser limpo (ou com `CI=1`, que desliga o cache).
  - **3 testes novos** (161 no total):
    - o quadro em t = 0 é o enquadramento calculado à parte (centro da caixa dos atores e o zoom que a faz caber com a margem), com os atores no lugar. Sem a correção, ele falha;
    - `seek(0)` depois de tocar, e um tamanho novo em t = 0, também saem enquadrados;
    - entre passos consecutivos, a câmera continua suavizada.


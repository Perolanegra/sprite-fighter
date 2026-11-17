---
description: Narrativa em pt-BR → cena roteirizada (scenes/<nome>.json), validada no motor, com prévia e a lista do que falta
argument-hint: <narrativa da cena>
---

Transforme esta narrativa numa cena do sprite-fighter:

> $ARGUMENTS

Você escreve a cena; o CLI `sf` (pacote `@perolanegra/sprite-fighter-cli`) só faz o trabalho determinístico (catálogo, validação, provisórias, prévia). Nada de API de IA, nada de chave. Não pergunte nada no meio: decida, registre as decisões em `assumptions` e siga.

## 1. Preparar

1. Descubra a pasta de assets: o campo `assets` do `sf.config.json` na raiz do projeto (sem o arquivo, `assets/`). Abaixo, `<assets>` é essa pasta; os comandos `sf` já a usam sozinhos. No monorepo do sprite-fighter, antes rode `npm run build` (rápido se nada mudou).
2. Leia o catálogo: `npx sf catalog` (a saída é só o JSON). É a lista completa do que existe: personagens (`characters.<id>`: `poses` com `description`, `tags` e `variants`, `provisional` com `from`, `moves` com duração e tipo de ataque), `clips`, `fx`, `props` (estados e ações), `actions` (ações TS para o `run` das fases de golpe: as embutidas e as do app, declaradas em `sf.actions.json` na raiz do projeto, com descrição e parâmetros), `commands` (parâmetros de cada comando do roteiro) e `events`.
3. Se houver cenas em `<assets>/scenes/`, leia uma como exemplo (formato, escalas, rotas, câmera, porta, reação por evento). O detalhe de cada comando (parâmetros e descrição) está no catálogo, em `commands`; o formato completo do roteiro, no README do sprite-fighter (seção "Roteiro").

## 2. Mapear a narrativa

Para cada ação da narrativa, decida e anote no `poseMap`:

- **Pose:** pelo nome, pela `description` e pelas `tags` do catálogo, só do personagem certo. `match`: `exact` (a pose é isso), `similar` (serve, com diferença), `provisional` (a pose escolhida existe só como provisória no catálogo, em `provisional`: ponha também `"from"` com a pose de onde vem a imagem; vale também para as poses que entram por golpes, ex.: o `dodge`), `missing` (nenhuma serve). Provisória **nunca** é `exact`/`similar`: o `validate` recusa.
- **Pose que falta:** use na cena um nome novo em snake_case (ex.: `kick_spin`), com `match: "missing"` (o comando `missing` cria a provisória e troca essa linha para `"provisional"` com o `from`), e declare em `missing` `{ "kind": "pose", "char", "name", "description" (o que o corpo faz, uma frase, pt-BR), "tags" (pt-BR, minúsculas), "closest" (a pose existente mais parecida: vira a imagem provisória), "why" }`.
- **Expressão e mão:** use `expression` / `hand` com uma variante do catálogo (`poses.<pose>.variants`, pelo `kind`). Se a narrativa pede uma que não existe, declare em `missing` `{ "kind": "variant", "char", "pose" (a pose com imagem que recebe a variante), "name", "variantKind": "expression" | "hand", "description", "tags", "why" }` e não use na cena um nome que não existe.
- **Golpe:** use um golpe do catálogo (`move`). Se nenhum serve, use o mais parecido e declare `{ "kind": "move", "char", "name", "why", "phases": [{ "name", "frames", "pose" }] }`. Comportamento que os dados não cobrem (teleporte, sumir) só por uma ação do catálogo (`actions`): na fase, `"run": "<ação>"` ou `"run": { "action": "<ação>", "params": { … } }` com os parâmetros que ela declara. Ação que não está no catálogo não existe: não invente; diga em `assumptions` que ela precisa ser escrita no app e declarada em `sf.actions.json`.
- **Props:** porta (`spawnProp` → `enter` → `prop close` → `hit:door-><id>`), parede.
- **Eventos que a narrativa afirma** ("o tiro acerta", "bate de cara na porta"): em `expectations` (`{ "event": "hit:<a>-><b>", "why" }`). O `validate` confere na simulação.
- Transições: sem `transition` (padrão smear/afterimage). `cut` só se a narrativa pedir corte seco.

## 3. Escrever os arquivos

Escolha um nome curto em kebab-case (sem acentos) a partir da narrativa e escreva:

- `<assets>/scenes/<nome>.json`: a cena no formato do motor (`title`, `seed`, `cast`, `camera`, `steps`). Use **só ids e nomes do catálogo** (mais as poses novas declaradas em `missing`). Nada de lógica de personagem: tudo é passo do roteiro.
- `<assets>/scenes/<nome>.narrative.json`, neste formato:

  ```json
  {
    "narrative": "<a narrativa exata>",
    "poseMap": [ { "action": "o neo desvia", "char": "<id>", "pose": "dodge", "match": "provisional", "from": "fly", "reason": "…" } ],
    "missing": [
      { "kind": "pose", "char": "<id>", "name": "kick_spin", "description": "…", "tags": ["chute"], "closest": "kick", "why": "…" },
      { "kind": "variant", "char": "<id>", "pose": "fly", "name": "angry", "variantKind": "expression", "description": "…", "tags": [], "why": "…" },
      { "kind": "move", "char": "<id>", "name": "spin_kick", "why": "…", "phases": [ { "name": "giro", "frames": 8, "pose": "kick_spin" } ] }
    ],
    "expectations": [ { "event": "hit:<a>-><b>", "why": "a narrativa diz que acerta" } ],
    "assumptions": [ "posições e tempos escolhidos" ]
  }
  ```

Regras de composição: personagens com escala ≈ 0,3 numa cena aberta; ninguém visível longe demais dos outros (a câmera automática enquadra os visíveis); toda cena termina (movimentos com duração).

## 4. Validar, criar o que falta e corrigir

1. `npx sf validate scenes/<nome>.json`
   - Se acusar pose que "ainda não existe" e que está declarada em `missing`, rode o passo 2 e valide de novo.
   - Corrija **todos** os erros na cena (ou no arquivo lateral) e valide de novo, até dar `OK`. Leia os avisos: variante que não existe na pose atual, provisória em uso, ação de golpe que não é embutida nem declarada (sem `sf.actions.json` ela é só aviso, e a simulação seca não a executa).
2. `npx sf missing scenes/<nome>.json`: grava as provisórias declaradas no manifesto e gera `<assets>/scenes/<nome>.missing.md` (prompts de imagem montados do manifesto + comandos `pose:add`). Rode sempre, mesmo sem nada declarado: ele lista também as provisórias que a cena já usava.
3. `npx sf preview scenes/<nome>.json`: screenshots nos tempos-chave e a folha `.sf/preview/<nome>/contato.png` (precisa do Playwright: `npm i -D playwright && npx playwright install chromium`).

## 5. Conferir as imagens

Abra a folha de contato (Read) e, quando algo parecer estranho, o quadro individual. Confira, quadro a quadro, contra a narrativa:

- cada ação aparece, na ordem, com a pose do `poseMap` (o debug `--debug` no preview mostra o nome da pose e a marca PROVISÓRIA);
- ninguém cortado ou fora do quadro; ninguém atravessando o que não devia (cabeça passando pela porta etc.);
- contatos com impacto (estrela/flash) quando a narrativa diz que acerta;
- props no lugar certo (a porta onde o personagem entra).

Corrigiu algo? Volte ao passo 4.1. Pare quando validate estiver `OK` e as imagens contarem a narrativa (no máximo umas 4 voltas; se algo persistir, diga o que e por quê).

## 6. Mostrar o resultado

Responda com:

- os caminhos da cena, do arquivo lateral e da folha de contato, e a URL para ver ao vivo: `npx sf lab` → `http://localhost:5180/?scene=script&file=scenes/<nome>.json` (com `&debug=1` para ver poses e PROVISÓRIA);
- a folha de contato (mostre o caminho absoluto do `contato.png`);
- o `poseMap` em tabela curta (ação → personagem/pose → exact/similar/provisional ← from/missing);
- **a lista do que falta**: poses (novas e provisórias que a cena usa), variantes e golpes, cada uma com o comando `pose:add` do `.missing.md`, e o caminho do `.missing.md` com os prompts de imagem;
- as suposições e os avisos que sobraram.

Não faça commit.

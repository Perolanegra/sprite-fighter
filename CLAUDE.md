# sprite-fighter — contexto do projeto

Biblioteca TypeScript que transforma **folhas de peças 2D (PNG)** em personagens articulados e anima
**cenas roteirizadas** com a linguagem visual de luta DBZ 2D (Supersonic Warriors / Extreme Butoden):
voo livre, golpes com contato (hitbox), hitstop, tremida de câmera, rastro e física de tecido.
**Não é um jogo**: não há jogador, teclado nem IA. Tudo é dirigido por um roteiro (JSON ou API TS).
Integração final em **Angular**.

O plano completo está em `PLANO.md`. Trabalhe **uma fase por vez**, na ordem, e só avance quando os
critérios de pronto da fase estiverem cumpridos.

## Assets
- `assets/sheets/neo-sheet-parts.png`: peças do personagem de sobretudo branco ("neo")
- `assets/sheets/smith-sheet-parts.png`: peças do agente de terno ("smith")
- **Id = pasta:** a pasta de cada personagem tem sempre o mesmo nome do id (`assets/poses/<coleção>/<id>/`,
  `assets/skins/<id>.json`, `assets/sheets/<id>-sheet-parts.png`). O CLI de poses e a carga recusam pasta com outro nome.
- `assets/reference/`: folhas de personagem completas (pose de voo, proporções e cores de referência)
- `reference/montar_personagem.py`: script em Python que já resolve pivôs por PCA, hierarquia e
  "attach" por fração da caixa. Use como **referência de algoritmo** (portar para TS), não como dependência.

Fundo das folhas: branco quase puro. As peças estão espaçadas, sem se tocar.

## Regras técnicas
- TypeScript `strict`. Monorepo com npm workspaces (`packages/*`, `apps/*`, `tools/*`).
- `packages/core` **sem dependências de runtime**. Renderização em Canvas 2D próprio.
- **Core genérico:** nenhum id, nome ou pasta de personagem no código do `core`, nem em comentários (use `<id>`
  nos exemplos). Tudo que é de um personagem vem dos manifestos e assets. O teste `generic.test.ts` garante isso.
- Simulação com **passo fixo de 120 Hz** + interpolação na renderização (rAF). Nada de lógica dependente de FPS.
- **Determinismo**: a mesma cena roda igual sempre (sem `Math.random` solto; use RNG com semente).
  Isso permite `seek(t)` (pular para qualquer momento) re-simulando a partir do início.
- **Golpes são dados** (JSON em fases). Comportamento novo que os dados não cobrem vira uma ação TS
  registrada com `registerAction(nome, fn)` e referenciada pelo nome no JSON.
- Unidades: posições em px do "mundo"; ângulos em **radianos** internamente (graus só em JSON de autoria);
  tempo de golpes em **frames de 60 fps** (padrão de jogos de luta), convertido internamente.
- Dados de autoria (atlas, rig, clipes, golpes) em **JSON** validado na carga, com mensagens de erro claras.
- Todo módulo de lógica pura (matemática, IK, molas, colisão, máquina de estados, sampler de clipes)
  tem testes com **Vitest**.
- Código e identificadores em inglês; README e comentários de autoria em português (pt-BR).
- Não adicionar dependências ao `core` sem perguntar. Dev deps (vite, vitest, sharp, playwright) liberadas.

## Como verificar o trabalho visual
Sempre que uma fase mexer no que aparece na tela:
1. rode a demo (`npm run dev -w apps/demo`);
2. capture screenshots com Playwright (`npm run shots`), nos momentos indicados pela fase;
3. **abra as imagens e analise** antes de dizer que terminou. Corrija o que estiver errado
   (peça fora do lugar, buraco na articulação, z-order trocado, tremedeira).

## Convenções de nomes das peças (atlas)
`head_<expr>`, `eyes_<expr>`, `mouth_<expr>`, `ear`, `torso`, `coat_skirt`, `shirt_torso`,
`coat_tail_1..3`, `jacket_tail_1..3`, `upper_arm_1..n`, `forearm_<pose>`, `hand_<pose>` (open, relaxed,
fist, gun, reach), `joint_cap_1..n`, `thigh_1..2`, `shin_1..2`, `knee_cap_1..2`, `ankle_1..2`, `shoe_1..2`,
`tie_knot`, `tie_mid`, `tie_tail`, `gun`.

## Ao terminar cada fase
- `npm test` e `npm run build` passando.
- Mudou formato, comando, CLI ou fluxo de autoria? Atualize o `README.md` (formatos, guias, ferramentas).
- Atualize a seção "Estado" no fim do `PLANO.md` (o que foi feito, decisões, pendências).
- Faça um commit `feat(fase-N): ...`.

## Commits
- **Sempre fazer commit ao final de cada tarefa** (não só das fases), separado por assunto quando a tarefa
  mexe em mais de uma coisa. Mensagem: `tipo(escopo): descrição` (`feat`, `fix`, `docs`, `chore`, `refactor`,
  `test`), em pt-BR. Repositório: https://github.com/Perolanegra/sprite-fighter (branch `main`).

# O que falta: scenes/chute-giratorio.json


## Pose neo · kick_spin (provisória ← kick)

### Prompt de imagem

```
Personagem: Neo, homem jovem, cabelo castanho curto e repicado, sobretudo longo bege-creme aberto com gola larga e botões nas mangas, colete e calça pretos, camisa branca, gravata preta, sapatos pretos de couro.
Pose: chute giratório no ar, corpo girando de lado com a perna da frente estendida num arco e o sobretudo rodando junto.
Estilo: anime detalhado de jogo de luta 2D, contorno escuro fino, sombreamento em cel com duas tonalidades, cores chapadas.
- o mesmo personagem das imagens de referência: mesmo rosto, cabelo, roupa, cores e proporções.
- corpo inteiro, de perfil virado para a direita, figura centralizada com margem em volta.
- fundo branco liso (#FFFFFF), sem cenário, sem sombra no chão, sem texto, sem moldura.
- mesmo traço, contorno e sombreamento das referências.
```

### Anexar

- assets/poses/code-call/neo/src/fly.png
- assets/poses/code-call/neo/src/punch.png
- assets/poses/code-call/neo/src/kick.png

### Depois de gerar

1. salve a imagem em assets/poses/code-call/neo/src/kick_spin.png
2. npm run pose:add -- --char neo --pose kick_spin --src assets/poses/code-call/neo/src/kick_spin.png --description "chute giratório no ar, corpo girando de lado com a perna da frente estendida num arco e o sobretudo rodando junto" --tags "chute,giro,giratório,ataque,corpo a corpo"
3. ajuste o esqueleto e a medida da cabeça no Pose Lab: ?scene=poselab&mode=image&char=neo&pose=kick_spin (e rode de novo: npm run atlas -- normalize --char neo)

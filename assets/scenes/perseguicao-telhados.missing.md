# O que falta: scenes/perseguicao-telhados.json


## Pose neo · dodge (provisória ← fly)

### Prompt de imagem

```
Personagem: Neo, homem jovem, cabelo castanho curto e repicado, sobretudo longo bege-creme aberto com gola larga e botões nas mangas, colete e calça pretos, camisa branca, gravata preta, sapatos pretos de couro.
Pose: desvia de um tiro jogando o corpo para cima e para o lado, torcido, ainda voando.
Estilo: anime detalhado de jogo de luta 2D, contorno escuro fino, sombreamento em cel com duas tonalidades, cores chapadas.
- o mesmo personagem das imagens de referência: mesmo rosto, cabelo, roupa, cores e proporções.
- corpo inteiro, de perfil virado para a direita, figura centralizada com margem em volta.
- fundo branco liso (#FFFFFF), sem cenário, sem sombra no chão, sem texto, sem moldura.
- mesmo traço, contorno e sombreamento das referências.
```

### Anexar

- assets/poses/code-call/neo/src/fly.png
- assets/poses/code-call/neo/src/punch.png

### Depois de gerar

1. salve a imagem em assets/poses/code-call/neo/src/dodge.png
2. npm run pose:add -- --char neo --pose dodge --src assets/poses/code-call/neo/src/dodge.png --description "desvia de um tiro jogando o corpo para cima e para o lado, torcido, ainda voando" --tags "esquiva,desvio,voo"
3. ajuste o esqueleto e a medida da cabeça no Pose Lab: ?scene=poselab&mode=image&char=neo&pose=dodge (e rode de novo: npm run atlas -- normalize --char neo)

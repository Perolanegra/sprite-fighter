# ngx-sprite-fighter

Componente Angular `<sf-scene>` (standalone) que toca as cenas roteirizadas do `sprite-fighter`.

```bash
npm run build:ng      # ng build ngx-sprite-fighter (pacote em packages/angular/dist) + app de exemplo
npm run ng:start      # app de exemplo em http://localhost:4300
npm run ng:check      # com o app rodando: screenshots e conferência de vazamentos (shots/out/)
```

## Uso

```ts
import { SfSceneComponent, type SfCharacters } from 'ngx-sprite-fighter';

// Só poses-imagem (o id é o nome do manifesto); `atlas` + `rig` acrescentam o rig de peças.
const cast: SfCharacters = {
  '<id>': { poses: 'skins/<id>.json', moves: 'moves/<id>.moves.json' },
};
```

```html
<sf-scene #scene [characters]="cast" script="scenes/<nome>.json" clips="clips/index.json"
          [autoplay]="true" (hit)="onHit($event)" (end)="onEnd()" />
```

| Input | Padrão | |
|---|---|---|
| `characters` | obrigatório | por id: `{ poses, moves?, atlas?, rig? }` (URLs) ou `{ character, moves }` já carregado |
| `script` | obrigatório | URL do roteiro, o JSON ou `script(...).toJSON()` |
| `clips` | `null` | URL do `index.json` dos clipes ou o mapa já carregado |
| `autoplay`, `loop`, `debug` | `false` | `loop`, `debug` e `timeScale` mudam ao vivo; o desenho de debug (`sprite-fighter/authoring`) só é baixado quando `debug` liga |
| `timeScale` | `1` | câmera lenta < 1 |
| `webgl` | `true` | `false` força o Canvas 2D (sem contexto WebGL) |
| `playOnVisible` | `false` | toca quando metade da cena entra na tela e pausa quando sai; se já terminou, recomeça |
| `parallax`, `background`, `overlay` | `null` | cenário (camadas de paralaxe, fundo, HUD) |

Outputs: `(ready)` `{ scene, duration, title }`, `(step)` (passo do roteiro começou/terminou), `(hit)`,
`(end)` e `(loadError)`. Métodos (via `viewChild`/`@ViewChild`): `play()`, `pause()`, `seek(t)`; leitura:
`time`, `duration`, `playing`, `scene`.

## Comportamento

- **Camadas:** o canvas do cenário fica embaixo; o renderer põe a camada WebGL dos personagens e a 2D da frente
  (efeitos, balões, HUD) por cima, no próprio host. As três mudam de tamanho juntas: tamanho do host
  (`ResizeObserver`) × DPR (reavaliado com `matchMedia` ao trocar de monitor ou de zoom). O host tem
  `aspect-ratio: 16 / 9` por padrão; mude com CSS.
- **Zona:** o `requestAnimationFrame` é agendado fora da zona do Angular (inclusive pelo `play()` chamado de um
  clique). Os quadros não disparam detecção de mudanças; os outputs voltam à zona só quando emitidos.
- **Carga:** antes do `(ready)`, as poses e variantes citadas pelo roteiro e as poses dos golpes são carregadas
  (a @2x só com DPR > 1,5) e sobem para a GPU. Trocar `characters`, `script`, `clips`, `webgl` ou o cenário
  remonta a cena (uma carga antiga é descartada).
- **Cache:** `SfAssets` (root) guarda personagens, golpes, clipes e roteiros por URL. Um mesmo personagem pode
  estar em várias cenas ao mesmo tempo.
- **Destruir:** para o laço, solta os ouvintes, libera texturas, buffers e shaders, perde o contexto WebGL
  (`WEBGL_lose_context`), tira as camadas do DOM e desliga os observers e o `matchMedia`.

# @perolanegra/sprite-fighter

Player de cenas de luta 2D roteirizadas a partir de poses-imagem (WebGL, com fallback Canvas 2D). Sem
dependências de runtime.

```ts
import { Character, Scene, parseMoves } from '@perolanegra/sprite-fighter';
import { checkScene, drawFightDebug, script } from '@perolanegra/sprite-fighter/authoring'; // só em autoria
```

- `@perolanegra/sprite-fighter`: o player (`Scene`, `Character`, `Director`, parsers, `registerAction`, `registerProp`).
- `@perolanegra/sprite-fighter/authoring`: conferência detalhada do roteiro, JSON Schema e docs dos comandos,
  API fluente (`script(...)`) e desenho de debug. Fica fora do bundle de quem não importa.

Documentação completa (formatos, guias, CLI, Angular): https://github.com/Perolanegra/sprite-fighter#readme

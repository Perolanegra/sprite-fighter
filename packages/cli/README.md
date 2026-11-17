# @perolanegra/sprite-fighter-cli

O CLI `sf` do sprite-fighter: trabalha na pasta de assets do seu app.

```bash
npx sf init --assets public/sf        # estrutura de assets, clipes, sf.config.json, sf.actions.json, /narrate
npx sf pose:add --char <id> --pose fly --src <imagem.png> --dir poses/<coleção>/<id>
npx sf lab                            # Pose Lab, tira de poses e cenas em http://localhost:5180
npx sf validate scenes/<cena>.json    # formato, nomes, ações (sf.actions.json), simulação seca
npx sf help                           # todos os comandos
```

A pasta de assets vem de `--assets`, `SF_ASSETS` ou do `sf.config.json` (padrão `assets/`). A prévia
(`sf preview`) precisa do Playwright: `npm i -D playwright && npx playwright install chromium`.

Documentação completa: https://github.com/Perolanegra/sprite-fighter#readme

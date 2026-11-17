import { Character } from '@perolanegra/sprite-fighter';

/** Id do personagem (o nome do manifesto em assets/skins/<id>.json). */
export type CharName = string;

/** Um personagem da pasta de assets; `parts` = também tem atlas e rig de peças (opcional). */
export interface CharEntry {
  id: string;
  parts: boolean;
}

let listing: Promise<CharEntry[]> | null = null;

/** Personagens disponíveis, lidos dos manifestos pelo servidor de dev (`/__sf/characters`). */
export function listCharacters(): Promise<CharEntry[]> {
  listing ??= fetch('/__sf/characters')
    .then((r) => (r.ok ? (r.json() as Promise<CharEntry[]>) : []))
    .catch(() => []);
  return listing;
}

const cache = new Map<string, Promise<Character>>();

/** Carrega um personagem: só com as poses-imagem ou, se tiver, também com o rig de peças. */
export function loadCharacter(id: CharName): Promise<Character> {
  let c = cache.get(id);
  if (!c) {
    c = (async () => {
      const list = await listCharacters();
      const entry = list.find((e) => e.id === id);
      // Sem a lista (build estático, sem o servidor de dev): tenta com as peças e cai para só poses.
      if (!list.length) return Character.load({ atlas: `/atlas/${id}.atlas.json`, rig: `/rigs/${id}.rig.json`, poses: `/skins/${id}.json` }).catch(() => Character.load({ poses: `/skins/${id}.json` }));
      if (!entry) throw new Error(`personagem desconhecido: ${id} (não há assets/skins/${id}.json)`);
      return entry.parts ? Character.load({ atlas: `/atlas/${id}.atlas.json`, rig: `/rigs/${id}.rig.json`, poses: `/skins/${id}.json` }) : Character.load({ poses: `/skins/${id}.json` });
    })();
    cache.set(id, c);
  }
  return c;
}

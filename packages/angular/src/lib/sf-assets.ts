import { Injectable } from '@angular/core';
import { Character, parseClip, parseMoves, type CastMember, type ClipData, type MoveData } from 'sprite-fighter';

/**
 * Um personagem por URL. O modo principal é só com poses-imagem:
 *   { poses: 'skins/<id>.json', moves: 'moves/<id>.moves.json' }
 * `atlas` + `rig` acrescentam o rig de peças (opcional). O id é o nome do arquivo do manifesto.
 */
export interface SfCharacterDef {
  poses: string;
  moves?: string;
  atlas?: string;
  rig?: string;
}

/** Elenco do `<sf-scene>`: por id, a definição por URL ou o personagem já carregado. */
export type SfCharacters = Record<string, SfCharacterDef | CastMember>;

/**
 * Cache dos assets por URL (personagens, golpes, clipes e roteiros), para o app todo: voltar a uma
 * rota ou ter duas cenas com o mesmo personagem não baixa nem monta tudo de novo. Uma carga que
 * falha sai do cache (a próxima tenta de novo).
 */
@Injectable({ providedIn: 'root' })
export class SfAssets {
  private readonly cache = new Map<string, Promise<unknown>>();

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    let p = this.cache.get(key) as Promise<T> | undefined;
    if (!p) {
      p = load();
      this.cache.set(key, p);
      p.catch(() => this.cache.delete(key));
    }
    return p;
  }

  character(def: SfCharacterDef): Promise<Character> {
    const key = `character ${def.poses}|${def.atlas ?? ''}|${def.rig ?? ''}`;
    return this.cached(key, () => (def.atlas && def.rig ? Character.load({ atlas: def.atlas, rig: def.rig, poses: def.poses }) : Character.load({ poses: def.poses })));
  }

  moves(url: string): Promise<Map<string, MoveData>> {
    return this.cached(`moves ${url}`, async () => parseMoves(await fetchJson(url), `golpes ${url}`));
  }

  /** Biblioteca de clipes: `index.json` lista os ids; cada clipe é `<id>.json` ao lado dele. */
  clips(indexUrl: string): Promise<Map<string, ClipData>> {
    return this.cached(`clips ${indexUrl}`, async () => {
      const base = new URL(indexUrl, document.baseURI);
      const ids = (await fetchJson(base.href)) as string[];
      const clips = await Promise.all(ids.map(async (id) => parseClip(await fetchJson(new URL(`${id}.json`, base).href), `clip ${id}`)));
      return new Map(clips.map((c) => [c.id, c]));
    });
  }

  /** JSON do roteiro (o `Scene.load` valida). */
  script(url: string): Promise<unknown> {
    return this.cached(`script ${url}`, () => fetchJson(url));
  }

  /** O elenco pronto para a cena: carrega (ou pega do cache) cada definição. */
  async cast(characters: SfCharacters): Promise<Record<string, CastMember>> {
    const entries = await Promise.all(
      Object.entries(characters).map(async ([id, c]): Promise<[string, CastMember]> => {
        if ('character' in c) return [id, c];
        const [character, moves] = await Promise.all([this.character(c), c.moves ? this.moves(c.moves) : undefined]);
        return [id, moves ? { character, moves } : { character }];
      }),
    );
    return Object.fromEntries(entries);
  }

  /** Esquece tudo (ex.: depois de trocar os arquivos no servidor). */
  clear(): void {
    this.cache.clear();
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`não foi possível carregar ${url} (${res.status})`);
  return res.json();
}

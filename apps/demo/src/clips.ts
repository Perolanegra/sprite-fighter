import { parseClip, type ClipData } from 'sprite-fighter';

let library: Promise<Map<string, ClipData>> | null = null;

/** Clipes de /clips (index.json lista os ids). São os mesmos para os dois personagens. */
export function loadClips(): Promise<Map<string, ClipData>> {
  library ??= (async () => {
    const ids = (await (await fetch('/clips/index.json')).json()) as string[];
    const clips = await Promise.all(ids.map(async (id) => parseClip(await (await fetch(`/clips/${id}.json`)).json(), `clip ${id}`)));
    return new Map(clips.map((c) => [c.id, c]));
  })();
  return library;
}

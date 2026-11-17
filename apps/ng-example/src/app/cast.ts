import type { SfCharacters } from 'ngx-sprite-fighter';

/** Os dois personagens só por poses-imagem (sem atlas nem rig de peças), com os golpes. */
export const CAST: SfCharacters = {
  neo: { poses: 'skins/neo.json', moves: 'moves/neo.moves.json' },
  smith: { poses: 'skins/smith.json', moves: 'moves/smith.moves.json' },
};

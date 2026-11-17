import { script } from 'sprite-fighter/authoring';

/**
 * A perseguição escrita com a API fluente. Gera o mesmo roteiro de `assets/scenes/chase.json`
 * (conferido em chase-api.test.ts); `?scene=chase&api=1` toca esta versão.
 */
export function chaseScript() {
  return script({
    title: 'perseguição: fly → shoot (o neo desvia) → porta → splat → fall',
    seed: 3,
    tail: 1.2,
    camera: { mode: 'auto', maxZoom: 0.6, minZoom: 0.3, margin: 110 },
  })
    .cast('smith', { at: [-560, 690], scale: 0.32, clip: 'idle_fly' })
    .cast('neo', { at: [-100, 640], scale: 0.32, clip: 'idle_fly' })
    .at(0).actor('neo').moveTo('M -100 640 C 400 470 900 700 1480 560', 2.2, { ease: 'sineInOut' }).as('fuga')
    .actor(null).fx('speedlines', { frames: 144, intensity: 0.4 })
    .at(0.05).actor('smith').moveTo('M -560 690 C -100 560 600 720 1280 600', 2.6, { ease: 'sineInOut' })
    .at(0.8).move('shoot', { target: 'neo' }).as('tiro1')
    .at(1.5).move('shoot', { target: 'neo' }).as('tiro2')
    .on('incoming:smith->neo', { nth: 1 }).actor('neo').move('dodge')
    .on('incoming:smith->neo', { nth: 2 }).move('dodge')
    .at(1.7).spawnProp('door', [1840, 300], [56, 440], { id: 'door', appear: 0.25 }).as('porta')
    .camera({ targets: ['neo', 'smith', 'door'] })
    .at(2.12).actor('neo').pose('enter')
    .at(2.2).enter('door', 0.5, { ease: 'cubicIn' }).as('entra')
    .at(2.65).actor('smith').moveTo([2150, 680], 0.7, { ease: 'power2In' })
    .after('entra', 0.06).prop('door', 'close', { duration: 0.1 }).as('fecha')
    .on('hit:door->smith').actor('smith')
    .parallel((p) => p.hover().pose('splat', { transition: 'cut' }).touch('door', 6).play('splat', { fade: 0 }).fx('impact_big', { dir: [-1, 0] }).fx('hitstop', { frames: 9 }))
    .as('splat')
    .after('splat', 0.4).moveTo([-40, 0], 0.18, { relative: true, ease: 'backOut' }).as('recuo')
    .after('recuo')
    .parallel((p) => p.pose('fall').play('fall', { fade: 8 }).fall({ vx: -90, vy: -120 }));
}

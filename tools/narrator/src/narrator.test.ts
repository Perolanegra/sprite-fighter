import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMissing } from './missing.js';
import { narrativeFor, parseNarrative } from './narrative.js';
import { keyTimes } from './preview.js';
import { validateScene } from './validate.js';

const ROOT = join(import.meta.dirname, '../../..');

/** Cópia dos assets sem fontes e @2x (o `missing` grava provisórias no manifesto). */
function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), 'sf-narrator-'));
  cpSync(join(ROOT, 'assets'), join(root, 'assets'), {
    recursive: true,
    filter: (src) => !/\/src(\/|$)|@2x|\/reference|\/sheets/.test(src.replace(ROOT, '')) && (!src.endsWith('.png') || /atlas\/[a-z]+\.atlas\.png$/.test(src)),
  });
  return root;
}

/** Cena "o neo dá um chute giratório" com a pose nova giro_teste (declarada em missing). */
function chute(root: string, narrative: Record<string, unknown> = {}): string {
  const file = join(root, 'assets/scenes/chute.json');
  writeFileSync(
    file,
    JSON.stringify({
      title: 'chute giratório',
      cast: { smith: { at: [520, 600], scale: 0.4, facing: -1, clip: 'idle_fly' }, neo: { at: [0, 600], scale: 0.4, clip: 'idle_fly' } },
      camera: { mode: 'auto', maxZoom: 0.7, margin: 140 },
      steps: [
        { id: 'gira', at: 0.4, actor: 'neo', do: 'pose', params: { name: 'giro_teste' } },
        { after: 'gira', delay: 0.6, actor: 'neo', do: 'pose', params: { name: 'fly' } },
      ],
    }),
  );
  writeFileSync(
    file.replace('.json', '.narrative.json'),
    JSON.stringify({
      narrative: 'o neo dá um chute giratório',
      poseMap: [{ action: 'o neo dá um chute giratório', char: 'neo', pose: 'giro_teste', match: 'missing', reason: 'kick é reto, sem giro' }],
      missing: [{ kind: 'pose', char: 'neo', name: 'giro_teste', description: 'chute giratório no ar, corpo girando com a perna estendida', tags: ['chute', 'giro'], closest: 'kick', why: 'kick não gira' }],
      expectations: [],
      assumptions: ['chute no ar, sem alvo'],
      ...narrative,
    }),
  );
  return file;
}

describe('arquivo lateral (narrative.json)', () => {
  it('lê o formato e acusa campos errados', () => {
    const n = parseNarrative({ narrative: 'x', poseMap: [], missing: [{ kind: 'variant', char: 'a', pose: 'fly', name: 'angry', variantKind: 'expression', description: 'bravo', tags: ['raiva'] }] });
    expect(n.missing[0]).toMatchObject({ kind: 'variant', variantKind: 'expression' });
    expect(() => parseNarrative({ missing: [{ kind: 'pose', char: 'a', name: 'KickSpin', description: 'x', closest: 'kick' }] })).toThrow(/missing\[0\]\.name: "KickSpin" precisa ser snake_case/);
    expect(() => parseNarrative({ poseMap: [{ action: 'x', char: 'a', pose: 'p', match: 'talvez' }] })).toThrow(/poseMap\[0\]\.match/);
    expect(() => parseNarrative({ missing: [{ kind: 'pose', char: 'a', name: 'x', description: 'x', tags: ['Giro'], closest: 'k' }] })).toThrow(/minúsculas/);
  });
});

describe('validate → missing → validate (pose que falta)', () => {
  it('pose declarada vira pendente; depois do missing a cena passa e o .missing.md tem o prompt e o pose:add', async () => {
    const root = sandbox();
    const assets = join(root, 'assets');
    const file = chute(root);
    const scene = () => JSON.parse(readFileSync(file, 'utf8'));
    const v1 = await validateScene(scene(), { assetsDir: assets, narrative: narrativeFor(file).narrative });
    expect(v1.ok).toBe(false);
    expect(v1.pending).toEqual([{ char: 'neo', pose: 'giro_teste' }]);
    expect(v1.errors[0]).toMatch(/pose "giro_teste" de "neo" ainda não existe: rode `npm run narrate -- missing/);

    const r = await runMissing(file, { assetsDir: join(root, 'assets') });
    expect(r.created).toEqual([{ char: 'neo', name: 'giro_teste', from: 'kick' }]);
    const manifest = JSON.parse(readFileSync(join(assets, 'skins/neo.json'), 'utf8'));
    expect(manifest.provisional.giro_teste).toMatchObject({ from: 'kick', description: 'chute giratório no ar, corpo girando com a perna estendida', tags: ['chute', 'giro'] });
    expect(r.poses.map((p) => [p.char, p.pose, p.status])).toEqual([['neo', 'giro_teste', 'provisória ← kick']]);
    const md = readFileSync(r.file, 'utf8');
    expect(md).toContain('Pose: chute giratório no ar');
    expect(md).toContain('- assets/poses/code-call/neo/src/kick.png');
    expect(md).toContain('npm run pose:add -- --char neo --pose giro_teste --src assets/poses/code-call/neo/src/giro_teste.png --description "chute giratório no ar, corpo girando com a perna estendida" --tags "chute,giro"');
    expect((await runMissing(file, { assetsDir: join(root, 'assets') })).created).toEqual([]); // de novo: não duplica

    // A linha do poseMap passou de "missing" a "provisional", com a pose de onde vem a imagem.
    expect(narrativeFor(file).narrative!.poseMap[0]).toMatchObject({ pose: 'giro_teste', match: 'provisional', from: 'kick' });
    const v2 = await validateScene(scene(), { assetsDir: assets, narrative: narrativeFor(file).narrative });
    expect(v2.errors).toEqual([]);
    expect(v2.provisional).toEqual([{ char: 'neo', pose: 'giro_teste', from: 'kick' }]);
    expect(v2.warnings).toContain('"neo" usa a pose provisória "giro_teste" (imagem de "kick"): falta a imagem (ver missing)');
  }, 60000);

  it('--no-provisional: não grava no manifesto, mas o .missing.md sai igual', async () => {
    const root = sandbox();
    const file = chute(root);
    const r = await runMissing(file, { assetsDir: join(root, 'assets'), provisional: false });
    expect(r.created).toEqual([]);
    expect(JSON.parse(readFileSync(join(root, 'assets/skins/neo.json'), 'utf8')).provisional.giro_teste).toBeUndefined();
    expect(r.poses[0]!.status).toMatch(/não gravada/);
    expect(r.poses[0]!.attach).toContain('poses/code-call/neo/src/kick.png');
  }, 60000);

  it('coerência do arquivo lateral; variante e golpe que faltam entram no .missing.md', async () => {
    const root = sandbox();
    const file = chute(root, {
      poseMap: [{ action: 'gira', char: 'neo', pose: 'giro_teste2', match: 'missing', reason: '' }],
      missing: [
        { kind: 'pose', char: 'neo', name: 'giro_teste', description: 'chute giratório', tags: [], closest: 'voadora', why: '' },
        { kind: 'variant', char: 'smith', pose: 'fly', name: 'angry', variantKind: 'expression', description: 'cara de raiva, dentes cerrados', tags: ['raiva'], why: '' },
        { kind: 'move', char: 'neo', name: 'spin_kick', why: 'nenhum golpe gira', phases: [{ name: 'giro', frames: 8, pose: 'giro_teste' }] },
      ],
    });
    const v = await validateScene(JSON.parse(readFileSync(file, 'utf8')), { assetsDir: join(root, 'assets'), narrative: narrativeFor(file).narrative });
    expect(v.errors).toContain('poseMap "gira": match "missing" para "giro_teste2", mas ela não está em "missing"');
    expect(v.errors).toContain('missing "giro_teste": closest "voadora" não é pose de "neo"');
    const md = (await runMissing(file, { assetsDir: join(root, 'assets'), provisional: false })).markdown;
    expect(md).toContain('## Variante smith · fly@angry');
    expect(md).toContain('mudando só a expressão do rosto: cara de raiva, dentes cerrados');
    expect(md).toContain('npm run pose:add -- --char smith --pose fly --variant angry --kind expression --src assets/poses/code-call/smith/src/fly@angry.png');
    expect(md).toContain('## Golpe neo · spin_kick');
  }, 60000);

  it('a perseguição: provisória usada por um golpe entra no aviso e no .missing.md; evento esperado conferido', async () => {
    const root = sandbox();
    const file = join(root, 'assets/scenes/chase.json');
    writeFileSync(file.replace('.json', '.narrative.json'), JSON.stringify({ narrative: 'x', expectations: [{ event: 'hit:door->smith', why: 'bate na porta' }, { event: 'hit:smith->neo', why: 'acerta' }] }));
    const v = await validateScene(JSON.parse(readFileSync(file, 'utf8')), { assetsDir: join(root, 'assets'), narrative: narrativeFor(file).narrative });
    expect(v.provisional).toEqual([{ char: 'neo', pose: 'dodge', from: 'fly' }]);
    expect(v.events['hit:door->smith']).toBe(1);
    expect(v.errors).toEqual(['a narrativa pede o evento "hit:smith->neo", mas ele não acontece (o golpe não acerta? confira distância, direção e tempo)']);
    const r = await runMissing(file, { assetsDir: join(root, 'assets') });
    expect(r.poses.map((p) => `${p.char}/${p.pose}`)).toEqual(['neo/dodge']);
  }, 60000);
});

describe('poseMap: provisória aparece como provisional', () => {
  it('exact numa provisória, provisional sem from ou com from errado: erros claros', async () => {
    expect(() => parseNarrative({ poseMap: [{ action: 'x', char: 'neo', pose: 'dodge', match: 'provisional', reason: '' }] })).toThrow(/match "provisional" precisa de "from"/);
    expect(() => parseNarrative({ poseMap: [{ action: 'x', char: 'neo', pose: 'fly', match: 'exact', from: 'fly', reason: '' }] })).toThrow(/"from" só vale com match "provisional"/);
    const root = sandbox();
    const file = join(root, 'assets/scenes/chase.json');
    const check = async (entry: Record<string, unknown>) => {
      writeFileSync(file.replace('.json', '.narrative.json'), JSON.stringify({ narrative: 'x', poseMap: [{ action: 'o neo desvia', char: 'neo', reason: '', ...entry }] }));
      return (await validateScene(JSON.parse(readFileSync(file, 'utf8')), { assetsDir: join(root, 'assets'), narrative: narrativeFor(file).narrative })).errors;
    };
    expect(await check({ pose: 'dodge', match: 'exact' })).toEqual(['poseMap "o neo desvia": "dodge" de "neo" é provisória (imagem de "fly"): use match "provisional" com from "fly", não "exact"']);
    expect(await check({ pose: 'dodge', match: 'provisional', from: 'kick' })).toEqual(['poseMap "o neo desvia": "dodge" é provisória a partir de "fly", não de "kick"']);
    expect(await check({ pose: 'fly', match: 'provisional', from: 'fly' })).toEqual(['poseMap "o neo desvia": match "provisional", mas "fly" de "neo" não é provisória']);
    expect(await check({ pose: 'dodge', match: 'provisional', from: 'fly' })).toEqual([]);
  }, 60000);
});

describe('preview: tempos-chave', () => {
  it('logo depois das trocas de pose, golpes, entrada, contato e o fim', async () => {
    const { times, duration } = await keyTimes(JSON.parse(readFileSync(join(ROOT, 'assets/scenes/chase.json'), 'utf8')), join(ROOT, 'assets'));
    const labels = times.map((k) => k.label).join(' | ');
    expect(labels).toContain('neo: pose enter');
    expect(labels).toContain('neo: enter door');
    expect(labels).toContain('hit door→smith');
    expect(labels).toContain('smith: pose fall');
    expect(times[0]!.label).toBe('início');
    expect(times.at(-1)!.t).toBeCloseTo(duration - 0.05, 3);
    expect(times.every((k, i) => i === 0 || k.t - times[i - 1]!.t >= 0.2)).toBe(true);
  }, 60000);
});

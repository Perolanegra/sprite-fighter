import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readManifest } from './pose.js';
import { assetsDir, inAssets } from '../paths.js';
import { imagePrompt } from './prompt.js';

/**
 *   sf pose:list --char <id> [--provisional]
 *
 * Lista as poses do personagem (com imagem e provisórias), com descrição, tags e arquivos. Para cada
 * provisória e cada pose do manifesto ainda sem imagem (ex.: a primeira de um personagem novo),
 * imprime o prompt de imagem pronto, as referências para anexar e os próximos comandos.
 * `--provisional` tira a tabela das poses com imagem.
 */
export async function runPoseList(argv: string[], root: string): Promise<void> {
  const i = argv.indexOf('--char');
  const char = i >= 0 ? argv[i + 1] : undefined;
  if (!char) throw new Error('uso: sf pose:list --char <id> [--provisional]');
  const onlyProvisional = argv.includes('--provisional');
  const m = await readManifest(root, char);
  const provNames = Object.keys(m.provisional);
  const rows: string[][] = [];
  if (!onlyProvisional)
    for (const p of m.poses) {
      const base = join(assetsDir(root), m.dir, p.name);
      const has = existsSync(`${base}.webp`);
      const files = [has ? 'webp' : '', existsSync(`${base}@2x.webp`) ? '@2x' : '', existsSync(`${base}.skin.json`) ? 'skin' : 'SEM skin']
        .filter(Boolean)
        .join(' ');
      let scale = '';
      if (existsSync(`${base}.skin.json`)) scale = `scale ${(JSON.parse(await readFile(`${base}.skin.json`, 'utf8')) as { scale?: number }).scale ?? 1}`;
      rows.push([p.name + (p.name === m.default ? ' (base)' : ''), has ? 'imagem' : 'SEM IMAGEM', `${files} ${scale}`.trim(), p.description || '(sem descrição)', p.tags.join(', ')]);
    }
  for (const name of provNames) {
    const v = m.provisional[name]!;
    rows.push([name, `PROVISÓRIA ← ${v.from}`, '', v.description || '(sem descrição)', v.tags.join(', ')]);
  }
  const who = m.character ? `${m.character.name} (${m.id})` : m.id;
  const withImage = m.poses.filter((p) => existsSync(join(assetsDir(root), m.dir, `${p.name}.webp`))).length;
  console.log(`\n${who} · ${withImage} com imagem, ${provNames.length} provisória(s) · pasta ${inAssets(m.dir)}\n`);
  printTable(['pose', 'situação', 'arquivos', 'descrição', 'tags'], rows);

  // Precisam de imagem: as provisórias e as poses já escritas no manifesto que ainda não têm a .webp.
  const pending = m.poses.filter((p) => !existsSync(join(assetsDir(root), m.dir, `${p.name}.webp`))).map((p) => p.name);
  const todo = [...pending, ...provNames];
  if (!todo.length) return console.log('\nNenhuma pose provisória ou sem imagem.');
  if (!m.character) console.log('\naviso: o manifesto não tem "character" (descrição visual e estilo); o prompt sai incompleto.');
  for (const name of todo) {
    const why = m.provisional[name] ? `provisória a partir de "${m.provisional[name]!.from}"` : 'sem imagem';
    console.log(`\n── ${name} (${why}) ${'─'.repeat(Math.max(4, 50 - name.length))}`);
    try {
      const p = imagePrompt(m, name);
      // Primeira pose de um personagem novo: ainda não há esqueleto deste personagem para copiar.
      if (name === m.default && !existsSync(join(assetsDir(root), m.dir, `${name}.skin.json`)))
        p.next[1] += '   (primeira pose: o esqueleto inicial é o modelo "humanoide"; --skeleton <id> copia o de outro personagem)';
      console.log(`\nPrompt de imagem:\n\n${p.prompt}\n`);
      console.log(`Anexar como referência:\n${p.attach.map((a) => `  - ${inAssets(a)}${existsSync(join(assetsDir(root), a)) ? '' : '  (NÃO ENCONTRADO)'}`).join('\n')}\n`);
      console.log(`Depois de gerar:\n${p.next.map((n, k) => `  ${k + 1}. ${n}`).join('\n')}`);
    } catch (e) {
      console.log(`  ${(e as Error).message}`);
    }
  }
}

function printTable(head: string[], rows: string[][]): void {
  const max = [24, 20, 26, 70, 40];
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const widths = head.map((h, c) => Math.min(max[c]!, Math.max(h.length, ...rows.map((r) => r[c]!.length))));
  const line = (r: string[]) => '  ' + r.map((v, c) => cut(v, widths[c]!).padEnd(widths[c]!)).join('  ').trimEnd();
  console.log(line(head));
  console.log('  ' + widths.map((w) => '─'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
}

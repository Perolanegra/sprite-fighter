import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from './init.js';

let log: string[];
beforeEach(() => {
  log = [];
  vi.spyOn(console, 'log').mockImplementation((m: string) => void log.push(String(m)));
});
afterEach(() => vi.restoreAllMocks());

describe('sf init', () => {
  it('cria a pasta de assets com os clipes, sf.config.json, sf.actions.json e o /narrate', () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-init-'));
    runInit(['--assets', 'public/sf'], root);
    for (const d of ['skins', 'poses', 'moves', 'scenes', 'clips']) expect(existsSync(join(root, 'public/sf', d)), d).toBe(true);
    expect(readdirSync(join(root, 'public/sf/clips'))).toContain('idle_fly.json');
    expect(readdirSync(join(root, 'public/sf/clips'))).toContain('index.json');
    expect(JSON.parse(readFileSync(join(root, 'sf.config.json'), 'utf8'))).toEqual({ assets: 'public/sf' });
    expect(JSON.parse(readFileSync(join(root, 'sf.actions.json'), 'utf8'))[0].name).toBe('teleport_front');
    expect(readFileSync(join(root, '.claude/commands/narrate.md'), 'utf8')).toMatch(/npx sf catalog/);
  });

  it('não sobrescreve o que já existe (só com --force)', () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-init-'));
    writeFileSync(join(root, 'sf.actions.json'), '[]');
    runInit([], root);
    expect(readFileSync(join(root, 'sf.actions.json'), 'utf8')).toBe('[]');
    expect(log.join('\n')).toMatch(/já existiam[\s\S]*sf\.actions\.json/);
    runInit(['--force'], root);
    expect(readFileSync(join(root, 'sf.actions.json'), 'utf8')).not.toBe('[]');
  });

  it('sem --assets, usa a pasta do sf.config.json (rodar de novo não cria outra pasta)', () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-init-'));
    runInit(['--assets', 'public/sf'], root);
    runInit([], root);
    expect(existsSync(join(root, 'assets'))).toBe(false);
    expect(log.join('\n')).toMatch(/pasta de assets public\/sf\//);
  });
});

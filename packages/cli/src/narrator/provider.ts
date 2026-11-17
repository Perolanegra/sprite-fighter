import type { Catalog } from './catalog.js';
import type { Narrative } from './narrative.js';

/**
 * Quem escreve a cena a partir da narrativa. Hoje é o Claude Code, pelo comando /narrate
 * (`.claude/commands/narrate.md`): ele lê o catálogo, escreve os arquivos e roda as ferramentas
 * determinísticas deste pacote (validate, missing, preview). Nenhuma chamada de IA sai daqui.
 *
 * Esta interface deixa pronto um modo opcional com um modelo local (ex.: Ollama, `http://localhost:11434`),
 * que ainda NÃO está implementado. Um provedor recebe a narrativa, o catálogo e, nas rodadas de
 * correção, os erros do `validate`, e devolve a cena e o arquivo lateral. O laço "escrever →
 * validar → corrigir" fica fora do provedor, igual ao do /narrate.
 */
export interface NarratorRequest {
  narrative: string;
  catalog: Catalog;
  /** Cenas de exemplo (ex.: a perseguição), no formato do motor. */
  examples: { narrative: string; scene: Record<string, unknown> }[];
  /** Rodada de correção: a cena anterior e os erros que o `validate` acusou nela. */
  previous?: { scene: Record<string, unknown>; narrative: Narrative; errors: string[] };
}

export interface NarratorDraft {
  /** Cena no formato do motor (`scenes/<nome>.json`). */
  scene: Record<string, unknown>;
  /** Arquivo lateral (`scenes/<nome>.narrative.json`): poseMap, missing, expectations, assumptions. */
  narrative: Narrative;
}

export interface NarratorProvider {
  /** Nome para mensagens (ex.: "ollama:qwen3"). */
  readonly name: string;
  /** O provedor está disponível (ex.: o servidor local responde)? */
  available(): Promise<boolean>;
  draft(request: NarratorRequest): Promise<NarratorDraft>;
}

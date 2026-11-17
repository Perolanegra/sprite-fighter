/**
 * sprite-fighter/authoring: o que serve para escrever e conferir cenas, fora do bundle do player.
 *
 *   import { checkScene, script, drawFightDebug } from 'sprite-fighter/authoring';
 *
 * - conferência detalhada do roteiro contra os personagens (`checkScene`, `checkScript`);
 * - JSON Schema e descrição dos comandos (`scriptSchema`, `COMMAND_DOCS`);
 * - API fluente (`script(...)`, que gera o mesmo JSON);
 * - debug: `drawFightDebug` (passe em `Scene.create(..., { debug: drawFightDebug })`) e `drawSkinDebug`.
 */
export { checkScene, checkScript, type ScriptCatalog } from './script-check.js';
export { COMMAND_DOCS, scriptSchema } from './script-docs.js';
export { script, ScriptBuilder, ParallelBuilder, type ScriptJson, type StepJson, type CastJson } from './script-builder.js';
export { drawFightDebug, drawSkinDebug } from './debug.js';
/** Leitor de JSON com mensagens por campo (o mesmo dos formatos do core), para formatos de ferramentas. */
export { Reader } from './validate.js';

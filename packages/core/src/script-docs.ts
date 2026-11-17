import { COMMANDS, type CommandSpec, type ParamSpec } from './script.js';

/**
 * Descrição de cada comando do roteiro e de cada parâmetro (autoria: JSON Schema, catálogo do
 * narrador, documentação). O player usa só a tabela `COMMANDS` (tipos e obrigatórios); um teste
 * garante que as duas tabelas têm os mesmos comandos e parâmetros.
 */
export const COMMAND_DOCS: Record<string, { doc: string; params: Record<string, string> }> = {
  pose: {
    doc: 'troca a pose-chave (sem transition: smear na ida, afterimage na volta à base; cut só se pedido)',
    params: { name: 'pose do manifesto', transition: 'transição', skin: 'skin (para quem também usa peças)' },
  },
  move: {
    doc: 'executa um golpe (moves/<id>.moves.json); termina quando o golpe acaba',
    params: { id: 'id do golpe', target: 'alvo (id do elenco); padrão: o mais perto' },
  },
  moveTo: {
    doc: 'vai até um ponto ou percorre uma rota (subconjunto de SVG path) em `duration` s; com `to: { prop, anchor }` o destino é uma âncora do prop, lida a cada passo (acompanha o prop)',
    params: { to: 'destino: [x, y] (px do mundo; só para posições livres no céu) ou { \"prop\": \"<id>\", \"anchor\": \"<âncora>\", \"offset\": [dx, dy] } (âncoras no catálogo, em props.<tipo>.anchors)', route: 'rota \"M x y C …\"', relative: '`to` [x, y] relativo à posição atual', align: '\"root\" (padrão: o quadril vai ao destino) ou \"center\" (o centro visual da silhueta da pose vai ao destino)', duration: 's', ease: 'easing', scaleTo: 'escala no fim (profundidade)' },
  },
  dash: {
    doc: 'impulso com arrasto e rastro; x é para a frente (sentido em que o ator olha)',
    params: { velocity: '[frente, y] px/s', drag: 'arrasto (1/s)', duration: 's' },
  },
  hover: {
    doc: 'flutua parado',
    params: {  },
  },
  fall: {
    doc: 'cai com gravidade (não termina)',
    params: { vx: 'px/s', vy: 'px/s inicial', gravity: 'px/s²' },
  },
  face: {
    doc: 'vira para um ator/prop ou para um lado',
    params: { target: 'id', dir: '1 = direita, -1 = esquerda' },
  },
  play: {
    doc: 'toca um clipe nos ossos da pose atual',
    params: { clip: 'id do clipe', fade: 'frames de mistura', speed: 'velocidade' },
  },
  camera: {
    doc: 'câmera: auto (enquadra), follow, pan, zoom, shake',
    params: { mode: 'modo', follow: 'id a seguir', pan: 'centro [x, y]', targets: 'ids que o auto enquadra (atores e props)', zoom: 'zoom (no auto, o teto); null solta', seconds: 'duração do pan/zoom (s)', shake: 'trauma 0..1', margin: 'margem do auto (px da tela)', minZoom: 'zoom mínimo do auto', maxZoom: 'zoom máximo do auto', snap: 'enquadra já, sem suavizar' },
  },
  fx: {
    doc: 'efeito (os mesmos dos golpes: impact, spark, flash, shake, speedlines, slowmo, hitstop, presets…); num passo `on`, sai no ponto do evento',
    params: { type: 'tipo ou preset', at: 'ponto [x, y]', dir: 'direção [x, y]' },
  },
  spawnProp: {
    doc: 'cria um prop (porta, parede); termina quando acaba de surgir',
    params: { type: 'tipo registrado (registerProp)', id: 'id (padrão: o tipo)', at: 'canto de cima à esquerda [x, y]', size: '[largura, altura]', state: 'estado inicial', appear: 's para surgir', facing: 'lado da frente: 1 = direita, -1 = esquerda (padrão); é onde fica a âncora front' },
  },
  prop: {
    doc: 'muda um prop: ação do tipo (porta: open/close) ou remove',
    params: { id: 'id do prop', action: 'ação (ou \"remove\")', duration: 's da animação' },
  },
  enter: {
    doc: 'entra num prop com abertura (porta): aproxima o centro visual até a âncora opening, sem flutuar perto da passagem, encolhendo e recortado pela abertura; some do outro lado. A partir de onde o ator estiver (de preferência um moveTo até a âncora front antes)',
    params: { prop: 'id do prop', duration: 's', ease: 'easing (padrão cubicIn)', shrink: 'escala no fim, em fração da atual (padrão: até 0,7, menos se precisar para caber no vão)' },
  },
  exit: {
    doc: 'sai de um prop com abertura (o contrário do enter): surge pequeno e recortado na passagem e vai até uma âncora (padrão front), crescendo até a escala de antes do enter',
    params: { prop: 'id do prop', duration: 's', ease: 'easing (padrão cubicOut)', to: 'âncora de destino (padrão front)', offset: 'deslocamento do destino [dx, dy]', scaleTo: 'escala no fim (padrão: a de antes do enter)', shrink: 'escala ao surgir, em fração da final' },
  },
  touch: {
    doc: 'encosta a frente do corpo na face do prop (para o movimento)',
    params: { prop: 'id do prop', gap: 'folga (px)' },
  },
  opacity: {
    doc: 'opacidade (0 some, 1 aparece)',
    params: { value: '0..1' },
  },
  expression: {
    doc: 'troca a expressão: a variante de textura (kind \"expression\") da pose atual e das próximas que a tiverem; \"none\" volta à imagem da pose. Sem a variante, a pose fica como está (aviso)',
    params: { name: 'variante (ex.: angry) ou \"none\"' },
  },
  hand: {
    doc: 'troca a mão: a variante de textura (kind \"hand\") da pose atual e das próximas que a tiverem; \"none\" volta à imagem da pose. Sem a variante, a pose fica como está (aviso)',
    params: { name: 'variante (ex.: nogun) ou \"none\"' },
  },
  say: {
    doc: 'balão de fala',
    params: { text: 'texto', seconds: 's (padrão 1,5)' },
  },
  wait: {
    doc: 'só espera (para encadear com after)',
    params: { seconds: 's' },
  },
  parallel: {
    doc: 'vários passos juntos (cada um com seu delay); termina quando todos terminam',
    params: {  },
  },

};

/** JSON Schema (2020-12) do roteiro, gerado da tabela de comandos. */
export function scriptSchema(): Record<string, unknown> {
  const paramSchema = (p: ParamSpec, doc: string | undefined): Record<string, unknown> => {
    const base: Record<string, unknown> = doc ? { description: doc } : {};
    switch (p.kind) {
      case 'number':
        return { ...base, type: 'number' };
      case 'string':
        return { ...base, type: 'string', ...(p.values ? { enum: [...p.values] } : {}) };
      case 'bool':
        return { ...base, type: 'boolean' };
      case 'vec2':
        return { ...base, type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 };
      case 'strings':
        return { ...base, type: 'array', items: { type: 'string' } };
      case 'zoom':
        return { ...base, type: ['number', 'null'] };
      case 'target':
        return {
          ...base,
          oneOf: [
            { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
            {
              type: 'object',
              properties: { prop: { type: 'string' }, anchor: { type: 'string' }, offset: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } },
              required: ['prop', 'anchor'],
              additionalProperties: false,
            },
          ],
        };
    }
  };
  const paramsOf = (name: string, spec: CommandSpec) => {
    const properties: Record<string, unknown> = Object.fromEntries(Object.entries(spec.params).map(([k, p]) => [k, paramSchema(p, COMMAND_DOCS[name]?.params[k])]));
    if (name === 'parallel') properties['steps'] = { type: 'array', minItems: 1, items: { $ref: '#/$defs/child' } };
    const required = Object.entries(spec.params).filter(([, p]) => p.required).map(([k]) => k);
    if (name === 'parallel') required.push('steps');
    return { type: 'object', properties, required, additionalProperties: !!spec.open };
  };
  const variants = (timing: boolean) =>
    Object.entries(COMMANDS).map(([name, spec]) => ({
      type: 'object',
      description: COMMAND_DOCS[name]?.doc,
      properties: {
        do: { const: name },
        id: { type: 'string' },
        ...(timing ? { at: { type: 'number', minimum: 0 }, after: { type: 'string' }, on: { type: 'string' }, nth: { type: 'integer', minimum: 1 } } : {}),
        delay: { type: 'number', minimum: 0 },
        actor: { type: 'string' },
        params: paramsOf(name, spec),
      },
      required: ['do', ...(spec.actor === 'required' && timing ? ['actor'] : []), ...(Object.values(spec.params).some((p) => p.required) || name === 'parallel' ? ['params'] : [])],
      additionalProperties: false,
      ...(timing ? { oneOf: [{ required: ['at'] }, { required: ['after'] }, { required: ['on'] }] } : {}),
    }));
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'sprite-fighter: roteiro de cena',
    type: 'object',
    properties: {
      title: { type: 'string' },
      seed: { type: 'number' },
      duration: { type: 'number' },
      tail: { type: 'number' },
      cast: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            at: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
            scale: { type: 'number' },
            facing: { enum: [1, -1] },
            pose: { type: 'string' },
            clip: { type: 'string' },
            opacity: { type: 'number' },
            collideProps: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      camera: paramsOf('camera', COMMANDS['camera']!),
      steps: { type: 'array', items: { $ref: '#/$defs/step' } },
    },
    required: ['steps'],
    additionalProperties: false,
    $defs: { step: { oneOf: variants(true) }, child: { oneOf: variants(false) } },
  };
}

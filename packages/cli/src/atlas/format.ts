/** Formatos legíveis dos arquivos de autoria (sem dependências: usado também pelo servidor do lab). */

/** Manifesto legível: `character` aberto, uma pose (e uma provisória) por linha. */
export function formatManifest(m: Record<string, unknown>): string {
  const line = (v: unknown) => JSON.stringify(v).replace(/","/g, '", "').replace(/":/g, '": ').replace(/,"/g, ', "').replace(/\{"/g, '{ "').replace(/\}/g, ' }').replace(/\{ +\}/g, '{}');
  const out = Object.entries(m).map(([k, v]) => {
    if (k === 'character' && v && typeof v === 'object')
      return `  "character": {\n${Object.entries(v).map(([ck, cv]) => `    ${JSON.stringify(ck)}: ${line(cv)}`).join(',\n')}\n  }`;
    if (k === 'poses' && Array.isArray(v)) return `  "poses": [\n${v.map((p) => '    ' + line(p)).join(',\n')}\n  ]`;
    if (k === 'provisional' && v && typeof v === 'object')
      return `  "provisional": {\n${Object.entries(v).map(([pk, pv]) => `    ${JSON.stringify(pk)}: ${line(pv)}`).join(',\n')}\n  }`;
    return `  ${JSON.stringify(k)}: ${line(v)}`;
  });
  return `{\n${out.join(',\n')}\n}\n`;
}

/** skin.json legível: um osso por linha. */
export function formatSkin(skin: Record<string, unknown> & { bones: unknown[]; chains?: unknown[] }): string {
  const { bones, chains = [], ...rest } = skin;
  const head = Object.entries(rest)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(',\n');
  return `{\n${head},\n  "bones": [\n${bones.map((b) => '    ' + JSON.stringify(b)).join(',\n')}\n  ],\n  "chains": [\n${chains.map((c) => '    ' + JSON.stringify(c)).join(',\n')}\n  ]\n}\n`;
}

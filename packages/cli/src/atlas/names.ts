/**
 * Nomes de peças válidos (convenção do CLAUDE.md). Duplicatas levam sufixo numérico
 * (`hand_fist_1`, `ear_2`).
 */
const WITH_VARIANT = /^(head|eyes|mouth|forearm|hand)_[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const SINGLE = /^(ear|torso|coat_skirt|shirt_torso|tie_knot|tie_mid|tie_tail|gun)(_\d+)?$/;
const NUMBERED = /^(coat_tail|jacket_tail|upper_arm|joint_cap|thigh|shin|knee_cap|ankle|shoe)_\d+$/;

export function isValidPartName(name: string): boolean {
  return WITH_VARIANT.test(name) || SINGLE.test(name) || NUMBERED.test(name);
}

/** Azulejos de rosto (fundo de pele quadrado) são desenhados por cima da cabeça. */
export function isOverlayName(name: string): boolean {
  return name.startsWith('eyes_') || name.startsWith('mouth_');
}

/** Problemas da lista de nomes: inválidos, repetidos e números sem nome. */
export function validateNames(names: Record<string, string>, count: number): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (let n = 1; n <= count; n++) {
    const name = names[String(n)];
    if (!name) {
      errors.push(`peça ${n}: sem nome`);
      continue;
    }
    if (!isValidPartName(name)) errors.push(`peça ${n}: "${name}" fora da convenção`);
    const other = seen.get(name);
    if (other) errors.push(`peça ${n}: "${name}" repetido (já usado na peça ${other})`);
    seen.set(name, String(n));
  }
  for (const key of Object.keys(names)) {
    if (!/^\d+$/.test(key) || Number(key) < 1 || Number(key) > count) errors.push(`chave "${key}" não corresponde a nenhuma peça (1..${count})`);
  }
  return errors;
}

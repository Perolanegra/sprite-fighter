/** Erro de dados de autoria (atlas, rig, clipe…), com o caminho do campo problemático. */
export class DataError extends Error {
  constructor(
    readonly source: string,
    readonly path: string,
    detail: string,
  ) {
    super(`${source}: ${path ? `${path}: ` : ''}${detail}`);
    this.name = 'DataError';
  }
}

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Leitor com mensagens claras ("rig <id>: bones[3].pivot: esperado …"). */
export class Reader {
  constructor(
    readonly source: string,
    readonly value: unknown,
    readonly path = '',
  ) {}

  fail(detail: string): never {
    throw new DataError(this.source, this.path, detail);
  }

  at(key: string | number): Reader {
    const v = this.value as Record<string | number, unknown> | undefined;
    const path = typeof key === 'number' ? `${this.path}[${key}]` : this.path ? `${this.path}.${key}` : key;
    return new Reader(this.source, v?.[key], path);
  }

  get present(): boolean {
    return this.value !== undefined && this.value !== null;
  }

  object(): Record<string, unknown> {
    if (typeof this.value !== 'object' || this.value === null || Array.isArray(this.value)) this.fail('esperado um objeto');
    return this.value as Record<string, unknown>;
  }

  array(): Reader[] {
    if (!Array.isArray(this.value)) this.fail('esperado uma lista');
    return (this.value as unknown[]).map((_, i) => this.at(i));
  }

  string(): string {
    if (typeof this.value !== 'string' || !this.value) this.fail('esperado um texto');
    return this.value as string;
  }

  number(): number {
    if (typeof this.value !== 'number' || !Number.isFinite(this.value)) this.fail('esperado um número');
    return this.value as number;
  }

  optNumber(fallback: number): number {
    return this.present ? this.number() : fallback;
  }

  optString(): string | undefined {
    return this.present ? this.string() : undefined;
  }

  oneOf<T extends string>(options: readonly T[], fallback?: T): T {
    if (!this.present && fallback !== undefined) return fallback;
    if (!options.includes(this.value as T)) this.fail(`esperado um de: ${options.join(', ')}`);
    return this.value as T;
  }

  /** Par de números [a, b]. */
  pair(): [number, number] {
    const items = this.array();
    if (items.length !== 2) this.fail('esperado [a, b]');
    return [items[0]!.number(), items[1]!.number()];
  }
}

/** Funções de easing (0..1 → 0..1, podendo passar de 1 nas com overshoot). */
export type EaseFn = (t: number) => number;

const PI = Math.PI;
const c1 = 1.70158;
const c3 = c1 + 1;
const c4 = (2 * PI) / 3;

export const EASINGS = {
  linear: (t) => t,
  step: (t) => (t < 1 ? 0 : 1),
  sineIn: (t) => 1 - Math.cos((t * PI) / 2),
  sineOut: (t) => Math.sin((t * PI) / 2),
  sineInOut: (t) => -(Math.cos(PI * t) - 1) / 2,
  quadIn: (t) => t * t,
  quadOut: (t) => 1 - (1 - t) * (1 - t),
  quadInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  cubicIn: (t) => t ** 3,
  cubicOut: (t) => 1 - (1 - t) ** 3,
  cubicInOut: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  power2In: (t) => t ** 3,
  power2Out: (t) => 1 - (1 - t) ** 3,
  expoOut: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  expoIn: (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
  backIn: (t) => c3 * t ** 3 - c1 * t * t,
  backOut: (t) => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2,
  backInOut: (t) => {
    const c2 = c1 * 1.525;
    return t < 0.5 ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2 : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },
  elastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1),
  bounceOut: (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
} satisfies Record<string, EaseFn>;

export type EaseName = keyof typeof EASINGS;
export const EASE_NAMES = Object.keys(EASINGS) as EaseName[];

export function ease(name: EaseName, t: number): number {
  return EASINGS[name](Math.min(1, Math.max(0, t)));
}

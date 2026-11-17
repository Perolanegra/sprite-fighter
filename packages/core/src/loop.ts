/** Passo fixo da simulação (120 Hz). */
export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;
/** Golpes e clipes são autorados em frames de 60 fps. */
export const AUTHOR_FPS = 60;
export const framesToSeconds = (frames: number) => frames / AUTHOR_FPS;

/**
 * Relógio de passo fixo: acumula o tempo real (× timeScale) e diz quantos passos de 1/120 s rodar,
 * mais a fração (`alpha`) para interpolar a renderização entre o passo anterior e o atual.
 * Não depende de FPS: a mesma sequência de passos acontece em qualquer máquina.
 */
export class FixedClock {
  timeScale = 1;
  paused = false;
  /** Tempo simulado total (s). */
  time = 0;
  steps = 0;
  private acc = 0;
  /** Teto por quadro (evita a "espiral da morte" depois de uma aba em segundo plano). */
  maxFrame = 0.25;

  /** Avança o tempo real `dt` e devolve quantos passos simular e o alpha da renderização. */
  advance(dt: number): { steps: number; alpha: number } {
    if (this.paused) return { steps: 0, alpha: this.acc / SIM_DT };
    this.acc += Math.min(dt, this.maxFrame) * this.timeScale;
    let steps = 0;
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      steps++;
    }
    this.steps += steps;
    this.time = this.steps * SIM_DT;
    return { steps, alpha: this.acc / SIM_DT };
  }

  reset(): void {
    this.acc = 0;
    this.steps = 0;
    this.time = 0;
  }
}

/**
 * Laço de animação no navegador: `step()` a 120 Hz fixos, `render(alpha)` a cada quadro.
 * Devolve a função que para o laço.
 */
export function runLoop(clock: FixedClock, step: (dt: number) => void, render: (alpha: number) => void): () => void {
  let last = performance.now();
  let raf = 0;
  const frame = (now: number) => {
    const { steps, alpha } = clock.advance((now - last) / 1000);
    last = now;
    for (let i = 0; i < steps; i++) step(SIM_DT);
    render(alpha);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

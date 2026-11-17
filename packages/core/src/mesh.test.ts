import { describe, expect, it } from 'vitest';
import { buildSkinMesh, delaunay, type MeshInput } from './mesh.js';

/** Silhueta sintética: dois retângulos (corpo e "perna") ligados, mais um retângulo solto separado por um vão. */
function figure(): MeshInput {
  const w = 220, h = 120;
  const alpha = new Uint8ClampedArray(w * h);
  const rgba = new Uint8ClampedArray(w * h * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        alpha[y * w + x] = 255;
        rgba.set([...rgb, 255], (y * w + x) * 4);
      }
  };
  fill(10, 10, 110, 50, [40, 40, 40]); // braço superior (escuro)
  fill(10, 70, 200, 110, [40, 40, 40]); // perna inferior (escura), separada por um vão de 20 px
  fill(100, 40, 130, 80, [40, 40, 40]); // ligação (os dois ficam conectados pela direita)
  fill(130, 70, 200, 110, [240, 230, 215]); // "tecido" claro na ponta da perna
  return {
    width: w,
    height: h,
    alpha,
    rgba,
    bones: [
      { head: { x: 20, y: 30 }, tail: { x: 100, y: 30 } }, // 0: braço
      { head: { x: 20, y: 90 }, tail: { x: 130, y: 90 } }, // 1: perna
      { head: { x: 135, y: 90 }, tail: { x: 195, y: 90 }, cloth: true }, // 2: tecido
    ],
    target: 450,
    boundaryStep: 6,
    seed: 3,
  };
}

const inside = (m: MeshInput, x: number, y: number) => {
  const xi = Math.floor(x), yi = Math.floor(y);
  // Tolera o halo de 3 px (a malha cobre a silhueta dilatada).
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (m.alpha[(yi + dy) * m.width + xi + dx]! > 0) return true;
  return false;
};

describe('delaunay', () => {
  it('triangula um quadrado com um ponto no meio em 4 triângulos', () => {
    expect(delaunay([0, 10, 10, 0, 5], [0, 0, 10, 10, 5]).length / 3).toBe(4);
  });
});

describe('buildSkinMesh', () => {
  const input = figure();
  const mesh = buildSkinMesh(input);

  it('fica na faixa de vértices e todos os triângulos caem dentro da silhueta (sem ponte no vão)', () => {
    expect(mesh.vertexCount).toBeGreaterThanOrEqual(250);
    expect(mesh.vertexCount).toBeLessThanOrEqual(800);
    const P = mesh.positions, T = mesh.triangles;
    for (let t = 0; t < T.length; t += 3) {
      const [a, b, c] = [T[t]!, T[t + 1]!, T[t + 2]!];
      const cx = (P[a * 2]! + P[b * 2]! + P[c * 2]!) / 3, cy = (P[a * 2 + 1]! + P[b * 2 + 1]! + P[c * 2 + 1]!) / 3;
      expect(inside(input, cx, cy)).toBe(true);
    }
  });

  it('cobre todos os pixels opacos', () => {
    // Amostra pixels opacos e confere que algum triângulo os contém.
    const P = mesh.positions, T = mesh.triangles;
    const contains = (x: number, y: number) => {
      for (let t = 0; t < T.length; t += 3) {
        const ax = P[T[t]! * 2]!, ay = P[T[t]! * 2 + 1]!, bx = P[T[t + 1]! * 2]!, by = P[T[t + 1]! * 2 + 1]!, cx = P[T[t + 2]! * 2]!, cy = P[T[t + 2]! * 2 + 1]!;
        const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by), d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy), d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
        if (!((d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6) && (d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6))) return true;
      }
      return false;
    };
    for (let y = 12; y < 108; y += 9) for (let x = 12; x < 198; x += 9) if (input.alpha[y * input.width + x]) expect(contains(x + 0.5, y + 0.5), `${x},${y}`).toBe(true);
  });

  it('é determinística (mesma entrada, mesma malha)', () => {
    const again = buildSkinMesh(figure());
    expect(Array.from(again.positions)).toEqual(Array.from(mesh.positions));
    expect(Array.from(again.triangles)).toEqual(Array.from(mesh.triangles));
  });

  it('mais densa perto das articulações', () => {
    const near = (x: number, y: number, r: number) => {
      let n = 0;
      for (let v = 0; v < mesh.vertexCount; v++) if (Math.hypot(mesh.positions[v * 2]! - x, mesh.positions[v * 2 + 1]! - y) < r) n++;
      return n;
    };
    // Articulação do braço (100, 30) × meio do braço (60, 30), mesma área.
    expect(near(100, 30, 14)).toBeGreaterThanOrEqual(near(60, 30, 14));
  });

  it('pesos: soma 1, até 4 ossos; o vão separa braço e perna; tecido só no claro', () => {
    const W = mesh.weights, I = mesh.boneIndices;
    const weightOf = (v: number, b: number) => {
      let w = 0;
      for (let k = 0; k < 4; k++) if (I[v * 4 + k] === b) w += W[v * 4 + k]!;
      return w;
    };
    for (let v = 0; v < mesh.vertexCount; v++) {
      expect(W[v * 4]! + W[v * 4 + 1]! + W[v * 4 + 2]! + W[v * 4 + 3]!).toBeCloseTo(1, 4);
      const x = mesh.positions[v * 2]!, y = mesh.positions[v * 2 + 1]!;
      // Lado esquerdo da perna (logo abaixo do vão): o braço, do outro lado do vão, quase não pesa.
      if (x < 60 && y > 75) expect(weightOf(v, 0)).toBeLessThan(0.05);
      // Parte escura longe do tecido: o osso de tecido não pesa.
      if (x < 100 && y > 75) expect(weightOf(v, 2)).toBeLessThan(0.05);
    }
  });
});

import { invert, multiply, type Mat2D } from './math.js';
import type { SkinMesh } from './mesh.js';
import type { Skeleton } from './skeleton.js';

/**
 * Matrizes de skinning (6 floats por osso): mundo atual × inversa do repouso. Levam um ponto da
 * imagem (com a raiz na origem) para o mundo.
 */
export function skinMatrices(skeleton: Skeleton, restInverse: Mat2D[], out = new Float32Array(restInverse.length * 6)): Float32Array {
  restInverse.forEach((inv, b) => {
    const m = multiply(skeleton.world[b]!, inv);
    out.set(m, b * 6);
  });
  return out;
}

export const invertAll = (mats: Mat2D[]) => mats.map((m) => invert(m));

/**
 * Skinning linear (LBS) na CPU: cada vértice = Σ peso × (matriz do osso · posição).
 * `offset` = o que subtrair das posições (a raiz do esqueleto, em px da imagem).
 */
export function deformLBS<T extends Float32Array>(mesh: SkinMesh, mats: Float32Array, offset: { x: number; y: number }, out: T = new Float32Array(mesh.positions.length) as T): T {
  const { positions, boneIndices, weights, vertexCount } = mesh;
  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 2]! - offset.x;
    const y = positions[v * 2 + 1]! - offset.y;
    let ox = 0, oy = 0;
    for (let k = 0; k < 4; k++) {
      const w = weights[v * 4 + k]!;
      if (!w) continue;
      const m = boneIndices[v * 4 + k]! * 6;
      ox += w * (mats[m]! * x + mats[m + 2]! * y + mats[m + 4]!);
      oy += w * (mats[m + 1]! * x + mats[m + 3]! * y + mats[m + 5]!);
    }
    out[v * 2] = ox;
    out[v * 2 + 1] = oy;
  }
  return out;
}

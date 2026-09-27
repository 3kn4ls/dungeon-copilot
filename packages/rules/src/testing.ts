import type { Random } from './dice';

/**
 * Fuente de aleatoriedad que produce exactamente los dados indicados, en orden.
 * Para tests: fixedDice(6, 6) hace que la siguiente tirada de 2d6 saque un doble 6.
 */
export function fixedDice(...faces: number[]): Random {
  for (const face of faces) {
    if (!Number.isInteger(face) || face < 1 || face > 6) {
      throw new Error(`Un dado solo puede sacar de 1 a 6, se pidió ${face}`);
    }
  }
  let index = 0;
  return () => {
    const face = faces[index++];
    if (face === undefined) throw new Error('fixedDice se quedó sin dados');
    return (face - 0.5) / 6;
  };
}

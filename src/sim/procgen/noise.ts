/** Hodnotový šum na celočíselné mřížce. Bez goniometrických funkcí. */
export function valueNoise(x: number, y: number, salt: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const v00 = hash01(x0, y0, salt);
  const v10 = hash01(x0 + 1, y0, salt);
  const v01 = hash01(x0, y0 + 1, salt);
  const v11 = hash01(x0 + 1, y0 + 1, salt);
  const ax = v00 + (v10 - v00) * sx;
  const bx = v01 + (v11 - v01) * sx;
  return ax + (bx - ax) * sy;
}

function hash01(x: number, y: number, salt: number): number {
  let mixed = Math.imul(x | 0, 0x6c078965) ^ Math.imul(y | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 4294967296;
}

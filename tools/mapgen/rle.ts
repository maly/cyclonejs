export function encodeRle(values: ArrayLike<number>): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  const length = values.length;
  if (length === 0) return runs;

  let index = values[0];
  let count = 1;
  for (let i = 1; i < length; i++) {
    const next = values[i];
    if (next === index) {
      count++;
    } else {
      runs.push([index, count]);
      index = next;
      count = 1;
    }
  }
  runs.push([index, count]);
  return runs;
}

export function decodeRle(runs: ReadonlyArray<readonly [number, number]>): number[] {
  let total = 0;
  for (const [, count] of runs) {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`Neplatný běh RLE: počet ${count}`);
    }
    total += count;
  }
  const out = new Array<number>(total);
  let position = 0;
  for (const [index, count] of runs) {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Neplatný běh RLE: index ${index}`);
    }
    for (let i = 0; i < count; i++) out[position++] = index;
  }
  return out;
}

export function decodeRleInto(runs: ReadonlyArray<readonly [number, number]>, target: Uint16Array): void {
  let position = 0;
  for (const [index, count] of runs) {
    if (!Number.isInteger(index) || index < 0 || !Number.isInteger(count) || count < 1) {
      throw new Error(`Neplatný běh RLE: [${index}, ${count}]`);
    }
    const end = position + count;
    if (end > target.length) {
      throw new Error(`RLE přeteklo cílovou délku ${target.length}`);
    }
    target.fill(index, position, end);
    position = end;
  }
  if (position !== target.length) {
    throw new Error(`RLE má délku ${position}, očekáváno ${target.length}`);
  }
}

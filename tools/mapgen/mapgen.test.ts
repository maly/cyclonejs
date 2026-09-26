import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { convertIndexed } from "./convert.ts";
import { mergeCloseRects } from "./islands.ts";
import { rgbaToIndexed, PALETTE_RGB } from "./palette.ts";
import { decodeRle, encodeRle } from "./rle.ts";
import { renderIndexed, renderRgba } from "./renderImage.ts";
import { tileKey } from "./tiles.ts";

describe("RLE", () => {
  it("kóduje a dekóduje prázdný vstup", () => {
    expect(encodeRle([])).toEqual([]);
    expect(decodeRle([])).toEqual([]);
  });

  it("kóduje jediný běh", () => {
    expect(encodeRle([7])).toEqual([[7, 1]]);
    expect(encodeRle([4, 4, 4, 4])).toEqual([[4, 4]]);
    expect(decodeRle([[4, 4]])).toEqual([4, 4, 4, 4]);
  });

  it("střídá běhy a dekódování vrací původní posloupnost", () => {
    const values = [1, 1, 1, 2, 2, 1, 0, 0, 0, 0];
    expect(encodeRle(values)).toEqual([
      [1, 3],
      [2, 2],
      [1, 1],
      [0, 4],
    ]);
    expect(decodeRle(encodeRle(values))).toEqual(values);
  });
});

describe("klíč dlaždice", () => {
  it("skládá 64 jednociferných indexů v řádkovém pořadí", () => {
    const pixels = new Uint8Array(64);
    pixels[0] = 1;
    pixels[63] = 8;
    const key = tileKey(pixels);
    expect(key).toHaveLength(64);
    expect(key).toBe(`${"1"}${"0".repeat(62)}${"8"}`);
  });

  it("odmítne jinou délku i index mimo paletu", () => {
    expect(() => tileKey([0, 1, 2])).toThrow(/64/);
    const pixels = new Uint8Array(64);
    pixels[5] = 9;
    expect(() => tileKey(pixels)).toThrow(/mimo rozsah/);
  });
});

describe("slučování obdélníků", () => {
  it("sloučí obdélníky vzdálené jednu buňku a nesloučí mezeru dvou buněk", () => {
    expect(
      mergeCloseRects([
        { x: 0, y: 0, w: 1, h: 1 },
        { x: 2, y: 0, w: 1, h: 1 },
      ]),
    ).toEqual([{ x: 0, y: 0, w: 3, h: 1 }]);

    expect(
      mergeCloseRects([
        { x: 0, y: 0, w: 1, h: 1 },
        { x: 3, y: 0, w: 1, h: 1 },
      ]),
    ).toEqual([
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 3, y: 0, w: 1, h: 1 },
    ]);
  });

  it("sloučí i šikmou mezeru jedné buňky", () => {
    expect(
      mergeCloseRects([
        { x: 0, y: 0, w: 1, h: 1 },
        { x: 2, y: 2, w: 1, h: 1 },
      ]),
    ).toEqual([{ x: 0, y: 0, w: 3, h: 3 }]);
  });

  it("po sjednocení dosáhne na obdélník, který se původních dílů nedotýkal", () => {
    expect(
      mergeCloseRects([
        { x: 0, y: 0, w: 10, h: 1 },
        { x: 0, y: 0, w: 1, h: 10 },
        { x: 8, y: 8, w: 1, h: 1 },
      ]),
    ).toEqual([{ x: 0, y: 0, w: 10, h: 10 }]);
  });
});

function paint(indices: Uint8Array, width: number, x: number, y: number, value: number) {
  indices[y * width + x] = value;
}

/** 36×12 px: pět sloupců a dva řádky buněk, poslední jsou neúplné. Dva ostrovy oddělené mořem. */
function twoIslandImage() {
  const width = 36;
  const height = 12;
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) paint(indices, width, x, y, 1);
  }
  paint(indices, width, 3, 3, 3);
  paint(indices, width, 8, 0, 4);
  for (let y = 8; y < 12; y++) {
    for (let x = 32; x < 36; x++) paint(indices, width, x, y, 6);
  }
  return { width, height, indices };
}

describe("převod syntetické mapy", () => {
  it("rozřeže dva ostrovy a neúplný okraj a vykreslí shodné pixely", () => {
    const image = twoIslandImage();
    const converted = convertIndexed(image);

    expect(converted.world.pixelWidth).toBe(36);
    expect(converted.world.pixelHeight).toBe(12);
    expect(converted.world.cellsWide).toBe(5);
    expect(converted.world.cellsHigh).toBe(2);
    expect(converted.summary.landCells).toBe(2);
    expect(converted.world.islands.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }))).toEqual([
      { id: 0, x: 0, y: 0, w: 1, h: 1 },
      { id: 1, x: 4, y: 1, w: 1, h: 1 },
    ]);

    const green = `${"1".repeat(8).repeat(3)}11131111${"1".repeat(8).repeat(4)}`;
    const speck = `4${"0".repeat(63)}`;
    const red = `${"66660000".repeat(4)}${"0".repeat(32)}`;
    expect(converted.atlas.tiles.map((tile) => tile.pixels)).toEqual(["0".repeat(64), green, speck, red]);
    expect(converted.atlas.tiles[0]).toMatchObject({ index: 0, count: 7, first: [2, 0], inIslands: false });
    expect(converted.atlas.tiles[1]).toMatchObject({ count: 1, first: [0, 0], inIslands: true });
    expect(converted.atlas.tiles[2]).toMatchObject({ count: 1, first: [1, 0], inIslands: false });
    expect(converted.atlas.tiles[3]).toMatchObject({ count: 1, first: [4, 1], inIslands: true });
    expect(converted.world.islands[0].tiles).toEqual([1]);
    expect(converted.world.islands[1].tiles).toEqual([3]);
    expect(converted.sea.rle).toEqual([
      [0, 1],
      [2, 1],
      [0, 8],
    ]);

    const rendered = renderIndexed(converted.atlas, converted.world, converted.sea);
    expect(rendered.width).toBe(image.width);
    expect(rendered.height).toBe(image.height);
    expect(Array.from(rendered.indices)).toEqual(Array.from(image.indices));

    const rgba = renderRgba(converted.atlas, converted.world, converted.sea);
    for (let i = 0; i < image.indices.length; i++) {
      const [redChannel, greenChannel, blueChannel] = PALETTE_RGB[image.indices[i]];
      expect(rgba.data[i * 4]).toBe(redChannel);
      expect(rgba.data[i * 4 + 1]).toBe(greenChannel);
      expect(rgba.data[i * 4 + 2]).toBe(blueChannel);
    }
  });

  it("mezeru jedné buňky uloží do ostrova a ve vrstvě moře ji vynuluje", () => {
    const width = 24;
    const height = 8;
    const indices = new Uint8Array(width * height);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) paint(indices, width, x, y, 1);
      for (let x = 16; x < 24; x++) paint(indices, width, x, y, 6);
    }
    paint(indices, width, 8, 0, 4);

    const converted = convertIndexed({ width, height, indices });
    expect(converted.world.islands).toHaveLength(1);
    expect(converted.world.islands[0]).toMatchObject({ id: 0, x: 0, y: 0, w: 3, h: 1 });
    expect(converted.world.islands[0].tiles).toEqual([1, 2, 3]);
    expect(converted.sea.rle).toEqual([[0, 3]]);

    const rendered = renderIndexed(converted.atlas, converted.world, converted.sea);
    expect(Array.from(rendered.indices)).toEqual(Array.from(indices));
  });

  it("dva běhy dají stejné JSON", () => {
    const image = twoIslandImage();
    const first = convertIndexed(image);
    const second = convertIndexed(image);
    expect(JSON.stringify(first.atlas)).toBe(JSON.stringify(second.atlas));
    expect(JSON.stringify(first.world)).toBe(JSON.stringify(second.world));
    expect(JSON.stringify(first.sea)).toBe(JSON.stringify(second.sea));
  });

  it("PNG tam a zpět zachová RGB", () => {
    const image = twoIslandImage();
    const converted = convertIndexed(image);
    const rgba = renderRgba(converted.atlas, converted.world, converted.sea);
    const png = new PNG({ width: rgba.width, height: rgba.height });
    rgba.data.copy(png.data);
    const decoded = PNG.sync.read(PNG.sync.write(png));
    expect(decoded.width).toBe(rgba.width);
    expect(decoded.height).toBe(rgba.height);
    expect(Buffer.compare(decoded.data, rgba.data)).toBe(0);
  });
});

describe("paleta", () => {
  it("nahlásí souřadnice barvy mimo paletu", () => {
    const data = new Uint8Array(5 * 3 * 4);
    const offset = (2 * 5 + 4) * 4;
    data[offset] = 1;
    data[offset + 1] = 2;
    data[offset + 2] = 3;
    data[offset + 3] = 255;
    expect(() => rgbaToIndexed(5, 3, data)).toThrow("[4, 2]");
    expect(() => rgbaToIndexed(5, 3, data)).toThrow("#010203");
  });
});

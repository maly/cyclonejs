import { describe, expect, it } from "vitest";
import { DEFAULT_VOLUME, readVolume } from "./sound.ts";

describe("hlasitost", () => {
  it("prázdné úložiště nechá výchozí mix", () => {
    expect(readVolume(null)).toBe(DEFAULT_VOLUME);
  });

  it("číslo mimo rozsah ořízne a nečíselný text zahodí", () => {
    expect(readVolume("0.5")).toBe(0.5);
    expect(readVolume("2")).toBe(1);
    expect(readVolume("-1")).toBe(0);
    expect(readVolume("nahlas")).toBe(DEFAULT_VOLUME);
  });
});

import type { LayoutMode } from "../sim/placement.ts";

export const LAYOUT_STORAGE_KEY = "cyclone-remake.layout.v1";

export function loadLayout(storage: Pick<Storage, "getItem"> | null): LayoutMode {
  try {
    return storage?.getItem(LAYOUT_STORAGE_KEY) === "original" ? "original" : "random";
  } catch {
    return "random";
  }
}

export function saveLayout(storage: Pick<Storage, "setItem"> | null, mode: LayoutMode): void {
  try {
    storage?.setItem(LAYOUT_STORAGE_KEY, mode);
  } catch {
    // Prohlížeč může úložiště zakázat. Volba pak platí jen do zavření stránky.
  }
}

import { nextInt, type RngState } from "./rng.ts";
import { ISLAND_CORPUS } from "./islandCorpus.ts";
import { SURNAMES } from "./surnames.ts";

const LONG = ["Long", "Needle", "Spine", "Lance", "Ribbon", "Finger", "Spear", "Strip", "Bar", "Spit"];
const CURVED = ["Hook", "Horseshoe", "Banana", "Claw", "Crescent", "Sickle", "Boomerang", "Arc", "Curl", "Bend"];
const BAY = ["Lagoon", "Harbour", "Cove", "Haven", "Inlet", "Basin", "Anchorage", "Bight", "Port", "Bay"];
const HIGH = ["Peak", "Ridge", "Crown", "Tor", "Summit", "Crest", "Spire", "Pinnacle", "Mount", "Crag"];
const SANDY = ["Sand", "Flat", "Driftwood", "Shoal", "Beach", "Dune", "Strand", "Barren", "Wash", "Shell"];
const FOREST = ["Pine", "Cedar", "Green", "Timber", "Grove", "Fir", "Willow", "Moss", "Thicket", "Oak"];
const SETTLED = ["Fisherman's", "Chapel", "Market", "Village", "Mission", "Beacon", "Ferry", "Wharf", "Parish", "Pilot"];
const ROUND = ["Button", "Pebble", "Dot", "Marble", "Pearl", "Coin", "Bead", "Disc", "Pip", "Nut"];
const WILD = ["Red", "Black", "White", "Grey", "Brown", "Gull", "Pelican", "Turtle", "Shark", "Heron", "Crab", "Seal"];

const GROUPS = {
  long: LONG,
  curved: CURVED,
  bay: BAY,
  high: HIGH,
  sandy: SANDY,
  forest: FOREST,
  settled: SETTLED,
  round: ROUND,
  wild: WILD,
} as const;

type Trait = keyof typeof GROUPS;
type Ending = "Island" | "Isles" | "Rocks" | "Cay" | "Key" | "Gateway" | "Point" | "Head";

export interface IslandProfile {
  id: number;
  cluster: number;
  base: boolean;
  area: number;
  /** Delší strana obdélníku dělená kratší. */
  aspect: number;
  /** Plocha ostrova dělená plochou konvexního obalu. Menší číslo znamená zahnutější tvar. */
  hullRatio: number;
  bays: number;
  maxHeight: number;
  sandRatio: number;
  treeDensity: number;
  houses: number;
}

interface Chain {
  starts: { key: string; n: number }[];
  next: Map<string, { ch: string; n: number }[]>;
  banned: Set<string>;
}

const CHAIN = train(ISLAND_CORPUS);

/** Jména ostrovů. Základna je vždy Base Island. Skupina Isles nebo Rocks má jedno společné jméno. Každé slovo jen jednou. */
export function nameIslands(state: RngState, islands: readonly IslandProfile[]): { state: RngState; names: string[] } {
  const names: string[] = [];
  const used = new Set<string>(["base"]);
  const endings = assignEndings(islands);
  state = finishEndings(state, islands, endings);
  const ordered = islands.slice().sort((a, b) => a.id - b.id);
  const grouped = new Set<number>();
  const bundles = groupBundles(ordered, endings);
  for (const bundle of bundles) {
    const roll = nextInt(state, 0, 99);
    state = roll.state;
    const picked = pickWord(state, groupProfile(bundle.members), roll.value, used);
    state = picked.state;
    used.add(picked.word.toLowerCase());
    const title = `${picked.word} ${bundle.ending}`;
    for (const island of bundle.members) {
      names[island.id] = title;
      grouped.add(island.id);
    }
  }
  for (const island of ordered) {
    if (island.base || grouped.has(island.id)) continue;
    const roll = nextInt(state, 0, 99);
    state = roll.state;
    const ending = endings.get(island.id) ?? "Island";
    const picked = pickWord(state, island, roll.value, used);
    state = picked.state;
    used.add(picked.word.toLowerCase());
    names[island.id] = `${picked.word} ${ending}`;
  }
  for (const island of ordered) {
    if (island.base) names[island.id] = "Base Island";
  }
  return { state, names };
}

function groupBundles(islands: readonly IslandProfile[], endings: Map<number, Ending>): { ending: Ending; members: IslandProfile[] }[] {
  const bundles: { ending: Ending; members: IslandProfile[] }[] = [];
  for (const ending of ["Rocks", "Isles"] as const) {
    const members = islands.filter((island) => endings.get(island.id) === ending);
    if (members.length >= 2) bundles.push({ ending, members });
  }
  return bundles;
}

function groupProfile(members: readonly IslandProfile[]): IslandProfile {
  let area = 0;
  let sand = 0;
  let trees = 0;
  let houses = 0;
  let bays = 0;
  let maxHeight = 1;
  let hullRatio = 1;
  let aspect = 1;
  for (const island of members) {
    area += island.area;
    sand += island.sandRatio * island.area;
    trees += island.treeDensity * island.area;
    houses += island.houses;
    bays += island.bays;
    if (island.maxHeight > maxHeight) maxHeight = island.maxHeight;
    if (island.hullRatio < hullRatio) hullRatio = island.hullRatio;
    if (island.aspect > aspect) aspect = island.aspect;
  }
  const first = members[0];
  return {
    id: first?.id ?? 0,
    cluster: first?.cluster ?? 0,
    base: false,
    area,
    aspect,
    hullRatio,
    bays,
    maxHeight,
    sandRatio: area > 0 ? sand / area : 0,
    treeDensity: area > 0 ? trees / area : 0,
    houses,
  };
}

function assignEndings(islands: readonly IslandProfile[]): Map<number, Ending> {
  const endings = new Map<number, Ending>();
  for (const island of islands) endings.set(island.id, "Island");
  const cap = Math.floor(islands.length * 0.25);
  const clusters = new Map<number, IslandProfile[]>();
  for (const island of islands) {
    if (island.base) continue;
    const list = clusters.get(island.cluster) ?? [];
    list.push(island);
    clusters.set(island.cluster, list);
  }
  let rocks: IslandProfile[] | null = null;
  for (const members of clusters.values()) {
    if (members.length < 2 || members.length > cap) continue;
    const rocky = members.every((island) => island.area < 200);
    if (!rocky) continue;
    const area = members.reduce((sum, island) => sum + island.area, 0);
    const best = rocks ? rocks.reduce((sum, island) => sum + island.area, 0) : Infinity;
    if (area < best) rocks = members;
  }
  if (rocks) for (const island of rocks) endings.set(island.id, "Rocks");
  let isles: IslandProfile[] | null = null;
  for (const members of clusters.values()) {
    if (members === rocks || members.length < 2 || members.length > cap) continue;
    if (members.every((island) => island.area < 200)) continue;
    const area = members.reduce((sum, island) => sum + island.area, 0);
    const best = isles ? isles.reduce((sum, island) => sum + island.area, 0) : -1;
    if (area > best) isles = members;
  }
  if (isles) for (const island of isles) endings.set(island.id, "Isles");
  return endings;
}

function finishEndings(state: RngState, islands: readonly IslandProfile[], endings: Map<number, Ending>): RngState {
  const sandy = islands.filter((island) => !island.base && island.area < 180 && island.maxHeight <= 3 && island.sandRatio >= 0.05 && endings.get(island.id) === "Island");
  if (sandy.length > 0) {
    const roll = nextInt(state, 0, sandy.length - 1);
    state = roll.state;
    const which = nextInt(state, 0, 1);
    state = which.state;
    const island = sandy[roll.value];
    if (island) endings.set(island.id, which.value === 0 ? "Cay" : "Key");
  }
  const plain = islands.filter((island) => !island.base && endings.get(island.id) === "Island");
  if (plain.length > 0) {
    const roll = nextInt(state, 0, plain.length - 1);
    state = roll.state;
    const which = nextInt(state, 0, 2);
    state = which.state;
    const island = plain[roll.value];
    const ending = which.value === 0 ? "Gateway" : which.value === 1 ? "Point" : "Head";
    if (island) endings.set(island.id, ending);
  }
  return state;
}

function pickWord(state: RngState, island: IslandProfile, kind: number, used: Set<string>): { state: RngState; word: string } {
  if (kind < 60) return pickList(state, GROUPS[trait(island)], used);
  if (kind < 85) return pickSurname(state, used);
  return pickProper(state, used);
}

function trait(island: IslandProfile): Trait {
  const ranked: { trait: Trait; strength: number }[] = [];
  if (island.aspect >= 1.9) ranked.push({ trait: "long", strength: (island.aspect - 1.6) / 1.4 });
  if (island.hullRatio < 0.92 && island.area >= 70) ranked.push({ trait: "curved", strength: (0.98 - island.hullRatio) / 0.35 });
  if (island.bays >= 3) ranked.push({ trait: "bay", strength: island.bays / 6 });
  if (island.maxHeight >= 4) ranked.push({ trait: "high", strength: (island.maxHeight - 2) / 3 });
  if (island.sandRatio >= 0.15 && island.maxHeight <= 2) ranked.push({ trait: "sandy", strength: island.sandRatio / 0.35 });
  if (island.houses >= 2) ranked.push({ trait: "settled", strength: island.houses / 3 });
  if (island.treeDensity >= 0.04 && island.area >= 40) ranked.push({ trait: "forest", strength: island.treeDensity / 0.08 });
  if (island.area <= 150 && island.aspect <= 1.5 && island.hullRatio >= 0.85) ranked.push({ trait: "round", strength: 0.45 });
  if (ranked.length === 0) return "wild";
  ranked.sort((a, b) => b.strength - a.strength || (a.trait < b.trait ? -1 : 1));
  return ranked[0]?.trait ?? "wild";
}

function pickList(state: RngState, words: readonly string[], used: Set<string>): { state: RngState; word: string } {
  const roll = nextInt(state, 0, words.length - 1);
  state = roll.state;
  for (let step = 0; step < words.length; step++) {
    const word = words[(roll.value + step) % words.length] ?? words[0] ?? "Isle";
    if (!used.has(word.toLowerCase())) return { state, word };
  }
  return pickList(state, WILD, used);
}

function pickSurname(state: RngState, used: Set<string>): { state: RngState; word: string } {
  const roll = nextInt(state, 0, SURNAMES.length - 1);
  state = roll.state;
  for (let step = 0; step < SURNAMES.length; step++) {
    const raw = SURNAMES[(roll.value + step) % SURNAMES.length] ?? "morgan";
    const given = `${raw.charAt(0).toUpperCase()}${raw.slice(1)}`;
    const word = given.endsWith("s") ? `${given}'` : `${given}'s`;
    if (!used.has(word.toLowerCase())) return { state, word };
  }
  return pickList(state, WILD, used);
}

function pickProper(state: RngState, used: Set<string>): { state: RngState; word: string } {
  for (let attempt = 0; attempt < 24; attempt++) {
    const length = nextInt(state, 4, 9);
    state = length.state;
    const made = markov(state, length.value);
    state = made.state;
    if (!made.word) continue;
    const key = made.word.toLowerCase();
    if (CHAIN.banned.has(key) || used.has(key)) continue;
    return { state, word: made.word };
  }
  return pickList(state, WILD, used);
}

function markov(state: RngState, length: number): { state: RngState; word: string | null } {
  if (CHAIN.starts.length === 0) return { state, word: null };
  const start = pickWeighted(state, CHAIN.starts);
  state = start.state;
  let text = CHAIN.starts[start.index]?.key ?? "";
  while (text.length < length) {
    const key = text.slice(text.length - 3);
    const options = CHAIN.next.get(key);
    if (!options || options.length === 0) return { state, word: null };
    const next = pickWeighted(state, options);
    state = next.state;
    text += options[next.index]?.ch ?? "";
  }
  return { state, word: text.charAt(0).toUpperCase() + text.slice(1) };
}

function pickWeighted(state: RngState, items: readonly { n: number }[]): { state: RngState; index: number } {
  let total = 0;
  for (const item of items) total += item.n;
  const roll = nextInt(state, 0, Math.max(0, total - 1));
  state = roll.state;
  let acc = 0;
  for (let index = 0; index < items.length; index++) {
    acc += items[index]?.n ?? 0;
    if (roll.value < acc) return { state, index };
  }
  return { state, index: items.length - 1 };
}

function train(words: readonly string[]): Chain {
  const startCount = new Map<string, number>();
  const nextCount = new Map<string, Map<string, number>>();
  const banned = new Set<string>();
  for (const raw of words) {
    const word = raw.toLowerCase();
    if (!/^[a-z]+$/.test(word) || word.length < 4) continue;
    banned.add(word);
    const start = word.slice(0, 3);
    startCount.set(start, (startCount.get(start) ?? 0) + 1);
    for (let index = 0; index < word.length - 3; index++) {
      const key = word.slice(index, index + 3);
      const ch = word.charAt(index + 3);
      const row = nextCount.get(key) ?? new Map<string, number>();
      row.set(ch, (row.get(ch) ?? 0) + 1);
      nextCount.set(key, row);
    }
  }
  const starts = [...startCount.entries()].map(([key, n]) => ({ key, n }));
  const next = new Map<string, { ch: string; n: number }[]>();
  for (const [key, row] of nextCount) {
    next.set(key, [...row.entries()].map(([ch, n]) => ({ ch, n })));
  }
  return { starts, next, banned };
}


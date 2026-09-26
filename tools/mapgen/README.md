# mapgen

Rozřeže čistou mapu Cyclone (`assets-src/CycloneMapClean.png`) na atlas dlaždic 8×8 a mapová data. Zpětné vykreslení se porovnává se vstupem po pixelech RGB. Bajty PNG se neporovnávají.

Výšky terénu, význam dlaždic ani názvy ostrovů tady nejsou. Nástroj ukládá jen barvy a rozřezání.

## Spuštění

Z kořene repozitáře, Node 20 nebo novější:

```bash
npm install
npm test
npm run mapgen
```

`npm run mapgen` udělá tři kroky:

| skript | co udělá |
| --- | --- |
| `mapgen:build` | vstup → `data/map/*.json`, náhledy v `tools/mapgen/out/` |
| `mapgen:render` | data → `tools/mapgen/out/render.png` |
| `mapgen:verify` | vykreslí data znovu a porovná RGB se vstupem |

Nenulový počet rozdílných pixelů zapíše `tools/mapgen/out/diff.png` (vstup ve stupních šedi, rozdíly červeně) a skončí s kódem 1. Adresář `tools/mapgen/out/` se necommituje.

## Vstup

PNG v měřítku 1:1 k pixelům Spectra. Povolené barvy, v tomto pořadí indexů palety:

`#00FFFF` `#00FF00` `#00CC00` `#000000` `#FFFFFF` `#CCCCCC` `#FF0000` `#FFFF00` `#CCCC00`

Jiná barva je chyba a vypíše se i se souřadnicí pixelu. Mřížka buněk 8×8 začíná na `[0, 0]`. Rozměr nemusí být násobkem 8: neúplné okrajové buňky se doplní mořem `#00FFFF` a renderer výsledek ořízne na původní rozměr, který je uložený v `world.json`.

## Formát dat

Soubory v `data/map/` jsou deterministické. Dva běhy nad stejným vstupem dají stejné bajty. JSON má stálé pořadí klíčů a odsazení dvěma mezerami.

Sdílené typy jsou v `src/world/mapFormat.ts`.

### `atlas.json`

- `tiles[0]` je vždy čistě mořská dlaždice, 64× index `0`.
- Ostatní dlaždice jdou v pořadí prvního výskytu při průchodu mřížkou (`y`, pak `x`).
- `pixels` je 64 znaků `0`–`8` v řádkovém pořadí buňky.
- `count` je počet výskytů v celé mřížce, `first` je `[x, y]` prvního výskytu v buňkách.
- `inIslands` říká, jestli se dlaždice vyskytuje v některém obdélníku ostrova.

### `world.json`

`pixelWidth` a `pixelHeight` jsou původní rozměr. `cellsWide` a `cellsHigh` jsou `ceil(rozměr / 8)`.

Ostrov je 8-souvislá pevninská komponenta. Pevnina je buňka, která obsahuje i jinou barvu než `#00FFFF` a `#FFFFFF`. Obdélníky komponent, které se po rozšíření o jednu buňku na každou stranu překrývají, se slučují, dokud se nic nemění. Výsledné obdélníky se nepřekrývají. Ostrovy jsou seřazené podle `y`, pak `x`, a číslované od 0.

`tiles` ostrova jsou indexy atlasu všech buněk jeho obdélníku, řádkově, včetně moře uvnitř obdélníku.

### `sea.json`

`rle` je pole dvojic `[index, počet]` pro celou mřížku v řádkovém pořadí. Buňky uvnitř obdélníků ostrovů mají v této vrstvě index `0`. Úplný obraz vznikne tak, že se nejdřív nakreslí tato vrstva a přes ni ostrovy. Hra vrstvu moře použít nemusí; je tu kvůli důkazu, že převod nic nezahodil.

## Výšky

`npm run mapgen:terrain` vezme `data/map/atlas.json`, `world.json`, `sea.json` a sémantiku dlaždic `data/map/semantics.json` a zapíše `data/map/terrain.json` a `data/map/terrain-issues.json` (konflikty, porušené hrany a kolize v buňkách půdorysu). Volitelný `data/map/terrain-patches.json` je pole `{ "x", "y", "height", "surface"? }` a na konci přepíše hotové buňky. Opravené buňky se ve zpětném promítnutí neporovnávají. Počet oprav se vypíše.

Pohled je od jihu. Horní plocha buňky půdorysu `(x, y)` s výškou `h` leží v řádku pohledu `y − h`. Svislý úsek jižní stěny o délce `k` zvedne oblast nad ním o `k` úrovní proti oblasti pod ním, nebo proti moři s výškou 0. Tečkovaná hrana (`N`, `W`, `E`, šikmé `D/` a `D\`) jen říká, která strana je výš. Písečné pobřeží otevřené na jih do moře má výšku 0.

Výstupní souřadnice ostrovů, stromů, lidí, beden a stěn jsou v buňkách půdorysu. `surface` je 0 moře, 1 tráva, 2 písek, 3 silnice, 4 bílá, 5 střecha, 6 beton. `estimated` označuje zakrytou souš doplněnou podle nejbližší známé buňky severně. Viditelné moře v tom sloupci zastaví souš: zátoka i severní pobřeží zůstanou moře. `exceptions` jsou dlaždice pohledu, které model nekreslí pravidlem, hlavně boční šrafy `stena_bok`. Sprite vrtulníku je v modelu bílá plocha heliportu a v pohledu zůstává jako výjimka.

Zpětné promítnutí porovná RGB s `assets-src/CycloneMapClean.png`. Nenulový rozdíl zapíše `tools/mapgen/out/terrain_diff.png` a skončí s kódem 1. Náhledy jsou `heights.png` (půdorys, 4 px na buňku) a `regions.png` (oblasti v pohledu).

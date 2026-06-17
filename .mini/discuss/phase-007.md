# Phase 7 — Vnořené .gitignore v podadresářích

## Intent
Rozšířit filtrování scanu tak, aby `.gitignore` v každé podsložce platil pro svůj
podstrom (vzory relativní k té složce), hlubší pravidlo přebíjelo mělčí včetně
re-include přes `!`. Prořezané (ignorované) podstromy se nečtou. Rozbitý vnořený
`.gitignore` degraduje stejně jako kořenový: varování, scan pokračuje.
Read-only kontrakt zůstává.

Ověřovací příklad: `src/.gitignore` ignoruje `*.log`, `src/sub/.gitignore` má
`!keep.log` → `src/a.log` v reportu NENÍ, `src/sub/keep.log` JE. Kořenové chování
z fáze 6 beze změny.

## Key decisions
- **Kořen sjednotit do zásobníku** (rozhodnutí uživatele): `loadDirIgnore` se volá
  i na kořeni, `cli.ts` přestane kořen přednačítat přes `loadGitignore`. Důvod:
  re-include musí fungovat i napříč kořenem (root `*.log` + `src` `!debug.log`),
  což jde jen když je kořen součástí téhož `test()`-based zásobníku, ne booleovský
  predikát stranou. "Beze změny chování fáze 6" hlídají EXISTUJÍCÍ testy
  (cli.gitignore.test.ts, gitignore.test.ts, scan.test.ts) — musí projít beze změny.
- **Varování per-soubor** (rozhodnutí uživatele): každý nečitelný/patologický
  vnořený `.gitignore` = vlastní řádka na stderr s cestou a důvodem, jako dnes
  kořen v cli.ts. Ne souhrn.
- **Architektura**: `scanTree` dostane injektovaný `loadDirIgnore(absDir) =>`
  výsledek nesoucí MATCHER + STAV (loaded/absent/unreadable/invalid). Drží zásobník
  matcherů (jeden na vstoupenou složku), push při vstupu / pop při výstupu.
  `scanTree` zůstává testovatelný — fake loader keyovaný na absDir, bez fs.
- **Matcher musí vystavit `test()` se stavem `{ignored, unignored}`**, ne jen
  booleovský `ignores()`. Bez rozlišení "ignoruj / výslovně NEignoruj přes ! /
  nemám názor" nejde implementovat "hlubší přebíjí". Vyhodnocení zásobníku:
  mělký→hluboký, vyhrává POSLEDNÍ rozhodný verdikt (ignored nebo unignored).
- **Cesta relativní k bázi**: každý matcher testuje cestu relativní k SVÉ složce
  (root matcher: `src/sub/keep.log`; src matcher: `sub/keep.log`; src/sub matcher:
  `keep.log`), oddělovač "/". Stack drží baseRel a strhává prefix.
- **Surfacing varování**: `loadDirIgnore` nesmí tisknout (zůstat čistý/testovatelný).
  Stav non-loaded/non-absent posbírá `scanTree` do výsledku (nové pole, např.
  `gitignoreWarnings: {path, reason}[]`), `cli.ts` je vypíše. Jinak tichá degradace
  = porušení kontraktu projektu.
- **Degradace jedné úrovně**: nečitelný/patologický vnořený `.gitignore` → podstrom
  se PŘESTO projde, jen bez pravidel té složky; pravidla předků dál platí.

## Watch out for
- **NEJVĚTŠÍ RIZIKO — re-include přes `!` možná nefunguje "zadarmo".** Knihovna
  `ignore` je stavěná na celý ruleset pro JEDNU bázi. Samostatné `!keep.log` (negace
  bez předchozího pozitivu ve stejné instanci) možná `test()` NEhlásí jako
  `unignored:true` → přednost hlubší úrovně se nepropíše a ověřovací příklad padne.
  → V `plan`/`do` HNED na začátku malý spike: ověřit, že `ignore({...}).add('!keep.log').test('keep.log')`
  vrací `unignored:true`. Mrknout do aktuální dokumentace `ignore` přes Context7.
  Plán B (pokud ne): skládat vzory předků do jednoho matcheru s přepočtem bází —
  výrazně složitější, zvážit dřív než se do toho pustí.
- **Tvar `loadGitignore`/`GitignorePredicate` se mění** (boolean → test()). Refaktor
  se dotkne kořene; existující testy fáze 6 jsou pojistka.
- **Git gotcha — test napsat**: pod prořezaným (ignorovaným) adresářem `!` soubor
  NEOŽIVÍ (Git tam neslézá). scanTree to dělá správně (do ignorované složky
  nevstupuje), ale chce to test, ať to nikdo "neopraví".
- **Výkon**: jeden readFile(.gitignore) navíc na KAŽDOU vstoupenou složku. Prořezané
  podstromy se nečtou (nevstupuje se), takže OK. Zmínit, ne řešit.
- **Self-review sub-agentem**: fáze sahá na chybové cesty (rozbitý vnořený gitignore),
  vstupní bod průchodu i kontrakt scanTree↔cli (warnings, ignoredByGitignore). Před
  reportem pustit nezávislého sub-agenta dle CLAUDE.md.
- **ignoredByGitignore counting**: zachovat sémantiku z fáze 6 (prořezaný adresář =
  1, ignorovaný soubor = 1). Re-include NESMÍ posunout počítadlo špatně.
- **Unhappy path změněné funkce**: prázdná složka, složka bez .gitignore, .gitignore
  jen s `!` bez pozitivu, nečitelný vnořený .gitignore nad čitelným podstromem,
  symlink na .gitignore, hluboká rekurze (zásobník nepřeteče vlastní logikou).

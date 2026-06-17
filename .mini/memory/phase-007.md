# Phase 7 — Vnořené .gitignore v podadresářích

**Goal:** Rozšířit skenování tak, aby se .gitignore v každém podadresáři aplikoval na svůj podstrom (vzory relativní k té složce), hlubší pravidla měla přednost (včetně re-include přes !), prořezané podstromy se nečetly a chybějící/nečitelný/patologický .gitignore v podadresáři degradoval stejně jako kořenový (varování, scan pokračuje). Architektura: čtení .gitignore v podsložkách probíhá až během průchodu (injektovaný loader loadDirIgnore(absDir) → matcher, ať scanTree zůstane testovatelný), udržovat zásobník matcherů (jeden na složku) a testovat cestu relativní k bázi každého. Read-only kontrakt zachován. Ověření: na stromu, kde src/.gitignore ignoruje *.log a src/sub/.gitignore obsahuje !keep.log, se src/a.log v reportu neobjeví, ale src/sub/keep.log ano; kořenové chování z fáze 6 zůstane beze změny.

## Steps
- [done] loadDirIgnore(absDir) – matcher se stavem {ignored, unignored}
- [done] scanTree: zasobnik matcheru pres injektovany loadDirIgnore
- [done] cli.ts: napojit loadDirIgnore + vypsat varovani per-soubor
- [done] Testy chovani faze 7 (re-include, gotcha, degradace)
- [done] Adversarialni self-review (nezavisly sub-agent) + finalni kontrola

## Auto-commit
- Phase 7: Vnořené .gitignore v podadresářích

## Discussion
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

## Run report
---
phase: 7
verdict: done
steps:
  - title: "loadDirIgnore(absDir) – matcher se stavem {ignored, unignored}"
    status: done
  - title: "scanTree: zasobnik matcheru pres injektovany loadDirIgnore"
    status: done
  - title: "cli.ts: napojit loadDirIgnore + vypsat varovani per-soubor"
    status: done
  - title: "Testy chovani faze 7 (re-include, gotcha, degradace)"
    status: done
  - title: "Adversarialni self-review (nezavisly sub-agent) + finalni kontrola"
    status: done
---

# Phase 7 — report z auto session

## Co se povedlo

Vnořené `.gitignore` fungují podle Gitu: každá vstoupená složka má svůj matcher,
drží se zásobník (jeden rámec na složku), verdikt jde mělký→hluboký a vyhrává
poslední rozhodný názor. Re-include přes `!` funguje napříč úrovněmi **i přes
kořen**, prořezané podstromy se nečtou (git gotcha: `!` pod ignorovanou složkou
soubor neoživí), rozbitý vnořený `.gitignore` jen varuje a scan běží dál.

- **Spike na začátku** potvrdil, že `ignore` v7.0.5 hlásí samostatné `!keep.log`
  jako `{ignored:false, unignored:true}` → plán A (zásobník nezávislých matcherů)
  drží, plán B (rebasování vzorů) nebyl potřeba.
- **Kořen sjednocen** do téhož mechanismu (`loadDirIgnore` se volá i na kořeni,
  `cli.ts` přestal kořen přednačítat). Strážce fáze 6 `cli.gitignore.test.ts`
  prošel **beze změny** → kořenové chování zachováno.
- Booleovský `loadGitignore` nahrazen `loadDirIgnore` (žádný mrtvý kód).
- `scanTree` zůstal testovatelný: loader je injektovaný, unit testy ho fakují
  keyovaný na absDir, bez sahání na fs.
- **Read-only kontrakt** zachován (do skenovaného stromu se nic nezapisuje).
- Testům jsem ověřil zuby mutací: dočasné rozbití re-include shodí přesně
  3 re-include testy (kanonický příklad, napříč kořenem, scan-unit).

Celkem 113 testů zelených (z toho 11 nových/přepsaných pro fázi 7 + 5 e2e),
typecheck čistý.

## Co adversariál našel a co jsem opravil

Nezávislý sub-agent (čerstvý kontext) potvrdil korektnost jádra proti reálnému
`git check-ignore` a našel **1 VÁŽNÝ self-catchable nález**, který jsem opravil:

- **Strop `MAX_GITIGNORE_LINE` hlídal špatnou osu.** Chytal jednu obří řádku, ale
  ne druhý tvar patologie: desetitisíce KRÁTKÝCH řádek. `.gitignore` se 200k řádek
  (každá pod limitem) projde a `ignore().add()` + `test()` blokuje ~1,3 s, a to
  per-složku. Empiricky naměřeno: 256 KiB ≈ 66 ms, 1 MiB ≈ 225 ms, 6 MiB ≈ 1,3 s.
  → Přidán druhý strop `MAX_GITIGNORE_BYTES = 256 KiB` (degradace PŘED kompilací,
  jako u dlouhé řádky) + 2 testy (hodně krátkých řádek → invalid; stovky řádek →
  loaded). 256 KiB je řádově nad reálnými `.gitignore` a drží worst-case do ~70 ms.

Druhý (DROBNÝ) nález — `loadDirIgnore` volán mimo try bloky ve `walk` — sub-agent
sám vyhodnotil jako záměrně správné: programová chyba má probublat se stackem do
launcher catche v `bin.ts`, ne být maskovaná jako tichý `absent`. S novými dvěma
stropy navíc `add()`/`test()` na patologický vstup vůbec nedojde. Beze změny.

## Rozhodnutí k zaznamenání (ADR)

Doporučuji před `/mini:done` spustit `/mini:decision` a zaznamenat křižovatku
**plán A vs plán B**: zásobník nezávislých matcherů (každý vrací `{ignored,
unignored}`, skládá se „poslední rozhodný vyhrává") funguje jen díky tomu, že
knihovna `ignore` reportuje i osamělou negaci jako `unignored`. To je netriviální
předpoklad ověřený spikem; kdyby ho příští upgrade knihovny porušil, padne to na
testu „SAMOSTATNÉ '!keep.log' hlásí unignored:true" a bude potřeba plán B
(rebasování vzorů předků do jednoho matcheru). Tahle úvaha z kódu později
nevyplyne.

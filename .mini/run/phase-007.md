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

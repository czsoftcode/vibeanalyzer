# Phase 28 — Sandbox importů: CompilerHost tsc

**Goal:** Dát tsc vlastní CompilerHost, který omezí čtení souborů a modul resolver na kořen projektu (plus přibalené lib/@types), takže import/reference mimo kořen už nevtáhne cizí obsah do reportu. Ověření: fixtura s importem mimo kořen nesmí dostat obsah toho souboru do reportu a zdravý TS projekt musí dál typovat bez falešných 'cannot find module'.

## Steps
- [done] Contained CompilerHost (kořen + lib allowlist)
- [done] Zapojit host do createProgram + opravit komentář
- [done] Test: import mimo kořen nevtáhne obsah
- [done] Test: zdravý TS projekt typuje bez falešných chyb
- [done] Nezávislý self-review + e2e

## Auto-commit
- Phase 28: Sandbox importů: CompilerHost tsc

## Run report
---
phase: 28
verdict: done
steps:
  - title: "Contained CompilerHost (kořen + lib allowlist)"
    status: done
  - title: "Zapojit host do createProgram + opravit komentář"
    status: done
  - title: "Test: import mimo kořen nevtáhne obsah"
    status: done
  - title: "Test: zdravý TS projekt typuje bez falešných chyb"
    status: done
  - title: "Nezávislý self-review + e2e"
    status: done
---

# Phase 28 — report z auto session

## Co bylo cílem
Zavřít poslední přiznanou díru ve strojové vrstvě (`tsc.ts`, komentář „ZBYTKOVÉ
RIZIKO"): `createProgram` běžel s DEFAULTNÍM hostem, takže `import "../../x"` nebo
`/// <reference path="../../x" />` UVNITŘ zdrojáků analyzovaného projektu mohly
resolverem sáhnout MIMO kořen a vtáhnout cizí obsah souborů do reportu (únik
důvěrnosti / probing FS). Pozn.: nešlo o spuštění cizího kódu — `tsc` jen parsuje
a typuje; ostatní vektory (cizí eslint/tsconfig/typescript, OOM/timeout) už byly
zavřené z dřívějška.

## Co se udělalo
- **`containedCompilerHost(ts, root, options)`** v `tsc.ts`: obaluje
  `ts.createCompilerHost(options)` a u `getSourceFile`/`fileExists`/`readFile`/
  `directoryExists` propustí jen cesty pod kořenem (symlink-rozplet přes existující
  `isUnderRootRealSync`) NEBO pod přibaleným TS lib adresářem
  (`path.dirname(ts.getDefaultLibFilePath(options))`). Mimo povolené → fail-closed,
  soubor se tváří jako neexistující.
- Gate sedí na ČTENÍ souboru = společný chokepoint pro modulový resolver i
  `/// <reference path>`. Záměrně se NEpřepisuje `resolveModuleNames` (ten by
  reference minul) ani `readDirectory`/`getDirectories`/`realpath` (vrací jen jména /
  cestu, obsah se bez čtení nevtáhne — stejná logika jako u `containedParseHost`).
- Zapojeno: `ts.createProgram(insideFiles, options, containedCompilerHost(...))`,
  komentář „ZBYTKOVÉ RIZIKO" přepsán na popis zavřené díry + trade-off.
- 3 nové testy: import mimo kořen (assert TS2307 + žádný marker/cesta ven),
  `/// <reference path>` mimo kořen (assert TS6053 + žádný marker), zdravý projekt
  s relativním importem + lib `Promise`/`Array` (0 nálezů, žádné falešné TS2307).

## Ověření (vše mechanicky, sám)
- `tsc --noEmit` čistý; celá sada **367 testů zelená** (45 souborů).
- **Zuby:** dvakrát jsem reálně vypnul gate (`allowed → true`) — oba leak testy
  fáze 28 spolehlivě padly (marker `ALSO_NONEXISTENT_REF_IDENTIFIER` se vtáhl, TS6053
  zmizel). Revert čistý.
- **E2E:** build + `node dist/bin.js` na fixtuře s `import "../secret"` mimo kořen →
  marker `NONEXISTENT_E2E_MARKER` se v `.md` ani JSON reportu NEOBJEVIL, místo toho
  TS2307. Žádný únik obsahu.

## Nezávislý self-review (čerstvý kontext) — proběhl, 2× should-know OPRAVENO
Pustil jsem red-team sub-agenta (nesdílí můj blind spot) na bypass gate, symlinky,
lib allowlist, case-sensitivity a zuby testů. Empiricky proti TS 6.0.3 ověřil, že
žádnou cestou se OBSAH cizího souboru do reportu nevtáhne (import, reference-path,
symlinkovaný soubor i ADRESÁŘ, rodičovské `node_modules`, bezchybný cizí soubor) —
**žádný must-fix**. Dva should-know nálezy jsem opravil:

- **N1 (OPRAVENO):** reference test ověřoval jen nepřítomnost markeru v hláškách,
  ne nepřítomnost ČTENÍ. Kdyby gate selhal a cizí soubor byl bezchybný, vtáhl by se
  TIŠE bez nálezu a test by prošel zeleně (falešný úspěch, past pro budoucí refaktor).
  Fix: přidán pozitivní signál zablokování `expect(... rule === "TS6053" ...)` —
  potvrzeno mutací, že bez gate padne. (Import test tuhle past neměl: jeho assert na
  TS2307 už je pozitivní důkaz neresolvování.)
- **N2 (OPRAVENO v dokumentaci):** komentář u `createProgram` zmiňoval jen
  project-references/typeRoots mimo root, ale dopad je širší — viz níže „verify".

Zbývající nálezy sub-agenta jsem vědomě NEřešil (nit / mimo rozsah V1):
- **N3 (should-know, teoretický):** `isUnderRootRealSync` dělá `realpathSync` i na
  neexistujících prob cestách → ENOENT → fail-closed `false`. Sub-agentovi se
  nepodařilo sestavit reálný vstup, který by to shodil (u existujícího souboru
  realpath projde dřív). Hlídat, ne přepisovat.
- **N4 (nit, výkon):** `realpathSync(root)` se počítá při každém I/O volání (root je
  invariant). Na velkém repu tisíce zbytečných syscallů. Vědomě neoptimalizuji
  (CLAUDE.md: nepřidávat vrstvy „pro budoucnost" bez teď-důvodu); je to nit, ne díra.
- **N5 (nit):** ruční `toLowerCase()` fold se teoreticky může lišit od host
  `getCanonicalFileName` u non-ASCII cest. Bezvýznamné pro ASCII.

## Pozor do budoucna / kandidát na backlog
Trade-off fail-closed: nad LEGITIMNÍM monorepem, kde `node_modules` (hoisted
závislosti) leží o úroveň VÝŠ než analyzovaná složka, se report teď zaplaví falešnými
TS2307 — a uživatel netuší, že je to artefakt analyzátoru, ne chyba jeho kódu.
Pro V1 je to vědomé (analyzujeme jen tuto složku, důvěrnost > pohodlí), ale stojí za
zvážení do backlogu: buď rozlišit „nenalezeno protože mimo root" od skutečného
TS2307, nebo to zmínit přímo v reportu (podobně jako už hlásíme chybějící
`node_modules`). Nezakládal jsem todo sám — nech na tobě.

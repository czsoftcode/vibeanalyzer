# Phase 29 — Doběh sandboxu fáze 28

**Goal:** Přidat regresní test symlinkové obrany realpath (28-4), omezit hromadění stderr v runIsolated stropem (28-3) a doplnit komentář k vědomě nezadrženému readDirectory/getDirectories v contained hostu (28-5); vše v src/analyze/, audit nálezy 28-1 a 28-2 zůstávají na samostatnou fázi.

## Steps
- [done] Regresní test symlinkového sync-gate (28-4)
- [done] Strop stderr v runIsolated se zachováním OOM (28-3)
- [done] Test stropu stderr + detekce OOM na konci
- [done] Nezávislý self-review + e2e

## Auto-commit
- Phase 29: Doběh sandboxu fáze 28

## Run report
---
phase: 29
verdict: done
steps:
  - title: "Regresní test symlinkového sync-gate (28-4)"
    status: done
  - title: "Strop stderr v runIsolated se zachováním OOM (28-3)"
    status: done
  - title: "Test stropu stderr + detekce OOM na konci"
    status: done
  - title: "Nezávislý self-review + e2e"
    status: done
---

# Phase 29 — report z auto session

## Co bylo cílem
Doběh sandboxu z fáze 28: tři necelé nálezy v `src/analyze/`.
- **28-4** (should-know): symlinková obrana realpath v `containedCompilerHost` neměla regresní test → budoucí výkonnostní optimalizace (zrušení/cache realpathu) by tiše obnovila leak a nic by to nechytlo.
- **28-3** (nit): `runIsolated` hromadil stderr dítěte bez stropu → patologicky upovídané dítě mohlo nafouknout paměť rodiče po celý timeout (vedlejší kanál navzdory izolaci).
- **28-5** (nit): jen odškrtnuto jako **už dokumentované** v kódu (`tsc.ts:207-209`) – komentář `readDirectory/getDirectories NEhlídáme … OBSAH se bez čtení nevtáhne` už označuje, že je to vědomé rozhodnutí. Žádná změna kódu, jak schváleno.

## Co se udělalo
- `src/analyze/runIsolated.ts`: konstanta `export const STDERR_CAP = 64 * 1024` + tail-preserving ořez v `'data'` handleru (`stderr.slice(stderr.length - STDERR_CAP)`). **Klíčové: držíme KONEC, ne začátek** – OOM signatura (`FATAL ERROR … heap out of memory`) přichází až těsně před abortem, takže head-only strop by ji zahodil a `looksLikeOom` by OOM přestal poznat.
- `src/analyze/runIsolated.test.ts`: 2 testy – (a) upovídané dítě s OOM signaturou na KONCI (>strop balastu) musí dál vyjít jako `oom`; (b) ~500 KiB balastu bez OOM signatury → `crashed` s detailem oříznutým na `STDERR_CAP` (test importuje reálnou konstantu, ne natvrdo zadanou kopii). Fixtury používají `writeSync(2,…)`, aby balast i koncová signatura deterministicky dorazily před `process.exit`.
- `src/analyze/tsc.test.ts`: 2 regresní testy – symlink uvnitř root mířící VEN, importovaný (`./link`) i referencovaný (`/// <reference path="./reflink.ts">`). Literální cesta je uvnitř root (chytil by ji i `isUnderRoot`), VEN míří až realpath → testy cílí přesně na sync gate `isUnderRootRealSync` (tsc.ts:226). Assert: marker cizího souboru se neobjeví + pozitivní signál (TS2307 / TS6053).

## Ověření zubů (mutacemi)
Každá změna ověřena záměrným rozbitím – test MUSÍ zčervenat:
- `isUnderRootRealSync → isUnderRoot` v `allowed()` → padly přesně **oba** symlink testy (leak markeru), ostatních 18 v `tsc.test.ts` zůstalo zelených.
- tail → head (`slice(0, CAP)`) → padl OOM-na-konci test (`crashed` místo `oom`).
- odstranění stropu → padl crash-ořez test (detail nabobtnal na ~512 K znaků).

## E2e
- `npm test`: **371 passed (45 souborů)**.
- `npm run typecheck` (`tsc --noEmit`): čistý.
- `npm run build` (`tsc`): čistý.
- Pozn.: projekt nemá `lint` script (ESLint běží jen jako analyzovaná vrstva uvnitř nástroje), takže lint vrstvu nahrazuje typecheck.

## Nezávislý self-review (čerstvý sub-agent)
Sub-agent v izolovaném worktree pustil vlastní mutace a potvrdil zuby všech čtyř testů. **Žádný blocker.** Nálezy jen vědomé kompromisy, které komentáře přiznávají:
- `chunk.toString()` per chunk může na hranici chunků rozseknout vícebajtový UTF-8 znak (U+FFFD) – neškodné pro ASCII OOM detekci, dopad jen na čitelnost ne-ASCII stderru. (Předexistující chování, neměnil jsem.)
- Strop je v UTF-16 code-unitách, ne bajtech → reálná paměť až ~2× CAP (128 KiB) u znaků mimo BMP. Cíl (konstantní strop místo lineárního růstu) splněn.

## Pozor do budoucna / kandidát na backlog
**Teoreticky nedosažitelná hrana stropu stderr:** kdyby dítě po `FATAL ERROR … heap out of memory` zapsalo ještě >64 KiB dalšího stderru, signatura by se z tail okna vytlačila a OOM by spadl na `crashed`. V reálném V8 OOM proces po této hlášce abortuje okamžitě, takže větev je prakticky nedosažitelná – nezakládal jsem todo. Kdyby se někdy ukázalo, že nějaký runtime po OOM ještě hodně píše, řešení je scanovat OOM regex na PŘÍCHOZÍ chunky před ořezem (sticky flag), ne na oříznutém okně.

Audit nálezy **28-1** (lockfile natvrdo `package-lock.json` i při `npm-shrinkwrap.json`) a **28-2** (rozporná čísla v `readCounts` fallbacku) zůstávají otevřené – byly vědomě vyčleněny na samostatnou fázi (jiný modul `src/audit.ts`, jiné téma).

# Phase 61 — Ošetřit pád čtení AI vrstvy

**Goal:** Selhání čtení souboru v splitAiPayload (TOCTOU mezi scanTree a AI během) degraduje AI vrstvu na skipped se srozumitelným důvodem místo pádu celého CLI, takže report s výsledky strojových vrstev vždy vznikne.

## Steps
- [done] Obalit setup + čtení AI vrstvy do try/catch
- [done] Catch degraduje vyžádané režimy na skipped
- [done] Test se zuby: rejectující readFile → AI skipped, report žije
- [done] Test se zuby: selhání dynamického importu degraduje
- [done] Ověřit beze změny tvaru AiReport + zelený typecheck a testy
- [done] Nezávislý self-review sub-agentem

## Auto-commit
- Phase 61: Ošetřit pád čtení AI vrstvy

## Discussion
# Phase 61 — Ošetřit pád čtení AI vrstvy

## Intent
AI vrstva (`runAiLayer`, volaná z `cli.ts:452`) jako JEDINÁ vrstva nemá kolem sebe
`try/catch` a nedegraduje na `skipped` (graf modulů `cli.ts:440-446`, tsc, ESLint,
secrets, audit ano). Uvnitř `splitAiPayload` (`aiPayload.ts:135`) se přes `Promise.all`
čtou VŠECHNY vybrané soubory; když jeden zmizí / změní práva mezi scanem stromu a AI
během (TOCTOU), `Promise.all` rejectne → chyba probublá `runAiLayer` → `run()` →
`runCli` catch → **exit 1, ŽÁDNÝ report** (zahodí se i hotové strojové vrstvy).
Cíl: selhání čtení (i selhání setupu AI vrstvy) degraduje vyžádané AI režimy na
`skipped` se srozumitelným důvodem, report se vždy vyrobí (exit 0).

## Key decisions
- **Varianta A (zvolena): přeskočit CELOU AI vrstvu**, ne jen nečitelný soubor.
  Konzistentní se všemi ostatními vrstvami, poctivé (uživatel vidí „AI neproběhla").
  Varianta B (skip jen souboru, jako `skippedUnreadable` ve stromu) ZAMÍTNUTA: mění
  tvar payloadu, AI by viděla neúplný projekt → tiché zkreslení nálezů → scope creep.
- **Rozsah catch: obalit čtení I dynamické importy.** Nechráněné jsou i `import()`
  na `cli.ts:567/573/574` (SDK/orchestrátor) – ty mají spadnout pod stejnou degradaci
  jako čtení souborů. Catch obalí blok od resolvování analyze/classify + importů přes
  `splitAiPayload` (klidně až po finální `return` úspěšné cesty).
- **Nemaskovat tiše:** v catchi VYPSAT stack na stderr a teprve pak degradovat na
  `skipped` (vzor `runOneAiMode` `cli.ts:689-692` a `--ai-check` `cli.ts:654-661`).
  Tím se kryje i nečekaná programová chyba, aniž by zmizela (CLAUDE.md pravidlo 2).
- **Které režimy jdou skipped:** jen VYŽÁDANÉ (`wantNonGoal`/`wantCode`/`wantLogic`)
  → `skipped`; nevyžádané zůstávají `pre` (ready) – přesně jako gate ceny `cli.ts:604-609`.
- **Reason text** poctivý k příčině, např. „AI vrstva přeskočena: čtení souborů
  projektu selhalo (soubor zmizel/změna práv během běhu nebo selhal setup) – viz stderr".

## Watch out for
- **BEZ bumpu JSON indexu.** Znovupoužíváme existující `AiStatus { kind: "skipped" }`,
  tvar `AiReport` se NEMĚNÍ → verze indexu zůstává. (Narozdíl od fáze 60.) Ověřit, že
  se opravdu nemění žádné pole.
- **`oversizedFiles` při selhání není k dispozici** (čtení nedoběhlo) → v degradované
  návratové hodnotě ho vynechat (jako u gate-skip se vyplňuje jen po úspěchu splitu).
- **Žádný úklid není potřeba:** `splitAiPayload` jen ČTE, po selhání nezůstává žádný
  stav/soubor. Nepřidávat zbytečnou cleanup větev.
- **Pozor na vnořené catche:** `runOneAiMode` má vlastní `try/catch` pro PROVOZNÍ
  chyby běhu částí – ten zůstává a do vnějšího catche se nedostane. Vnější catch řeší
  jen setup+čtení (a nečekané). Nepřekrýt jejich odpovědnosti.
- **Test se zuby přes REÁLNÝ kód, ne mock literál (CLAUDE.md pravidlo 4/cross-module):**
  `readFile`, který pro jeden soubor rejectne (ENOENT/EACCES), poslat přes REÁLNÝ
  `splitAiPayload` + `runAiLayer` → ověřit: vyžádané režimy = `skipped`, strojové
  vrstvy v reportu zůstaly, exit 0. Druhý test: selhání dynamického importu (přes deps
  injektáž nebo simulaci) → také degradace, ne pád. Když ochranný catch dočasně rozbiju,
  test musí spadnout.
- **Nezahltit catch tak, aby polkl i úspěšnou cestu** – estimate/gate/runs musí dál
  fungovat normálně; degradace je jen pro chybový průchod.
- Před reportem nezávislý self-review sub-agentem (fáze sahá na chybovou cestu a vstupní
  bod procesu – CLAUDE.md).

## Run report
---
phase: 61
verdict: done
steps:
  - title: "Obalit setup + čtení AI vrstvy do try/catch"
    status: done
  - title: "Catch degraduje vyžádané režimy na skipped"
    status: done
  - title: "Test se zuby: rejectující readFile → AI skipped, report žije"
    status: done
  - title: "Test se zuby: selhání dynamického importu degraduje"
    status: done
  - title: "Ověřit beze změny tvaru AiReport + zelený typecheck a testy"
    status: done
  - title: "Nezávislý self-review sub-agentem"
    status: done
---

# Phase 61 — report z auto session

## Co se udělalo
V `runAiLayer` (`src/cli.ts`) je nově blok od dynamických importů SDK/orchestrátoru přes
`splitAiPayload` až po úspěšný `return` obalený jedním `try/catch`. Na chybu (TOCTOU čtení
souboru, selhání dynamického importu, případně nečekaná programová chyba) catch vypíše
**stack na stderr** a degraduje VYŽÁDANÉ AI režimy na `skipped`; nevyžádané zůstanou `pre`
(ready) – stejně jako gate-skip větev. Tím se chová jako každá jiná vrstva (tsc/ESLint/
secrets/audit/moduleGraph) a report se vyrobí i s výsledky strojových vrstev (exit 0).
Dřív chyba probublala až do `runCli` → exit 1 a žádný report.

## Testy (mají zuby – ověřeno mutací)
- `src/cli.ai.test.ts` – nový `it` "TOCTOU": jeden `.ts` zamčen `chmod 0o000`. `scanTree` ho
  jen statuje (obsah nečte) → zůstane AI kandidátem → reálný `splitAiPayload` na něm hodí
  EACCES. Ověřeno: vyžádaný režim `skipped`, nevyžádané `ready`, strojové vrstvy (`files`,
  `tsc`) v reportu, `analyze` nevolán, exit 0, na stderr "AI vrstva selhala nečekaně".
  `readFile` v `splitAiPayload` není injektovatelný → test jede přes REÁLNÝ kód, ne mock.
- `src/cli.aifail.test.ts` (nový soubor) – `vi.mock` shodí import `aiChunkedRun.js`
  (simulace rozbitého buildu). Ověřeno: stejná degradace, exit 0. Izolováno do vlastního
  souboru, protože `vi.mock` je file-scoped.
- Mutace (dočasný `throw err` v catchi) → OBA testy padnou (chyba probublá
  `splitAiPayload → runAiLayer → run`). Mutace vrácena.

## Self-review sub-agentem (čerstvý kontext) → 1 oprava
Sub-agent (CLAUDE.md vyžaduje u chybových cest / vstupních bodů) potvrdil zuby testů a
správnost degradace, ale našel reálný WARNING: původní text důvodu `skipped` natvrdo tvrdil
příčinu „soubor zmizel / změna práv", jenže širší catch kryje i selhání importu / `RangeError`
ze `splitAiPayload` / throw z `estimateAiCost`/`ask` → report by **lhal o příčině** (maskování
programové chyby jako I/O, porušení CLAUDE.md pravidla 2). **Opraveno:** důvod je teď
generický `"AI vrstva (čtení souborů projektu / příprava běhu) selhala (viz stderr)"` –
skutečnou příčinu i stack nese stderr (přesně vzor ostatních vrstev „… selhal (viz stderr)").

## Rozhodnutí (vědomá, ne regrese)
- **Široký catch (importy + čtení + estimate + gate + runs), nezužovat:** přímo dle diskuse
  („obalit čtení i importy, klidně až po finální return"). Je to konzistentní s konvencí
  projektu: tsc/ESLint/moduleGraph/`runOneAiMode`/`--ai-check` všechny dělají catch-all +
  stack + degradace, NErethrowují programovou chybu. Stack na stderr = „není tiché spolknutí".
- `runOneAiMode` má vlastní `try/catch` pro PROVOZNÍ chyby běhu částí → do vnějšího catche
  nepropadnou, odpovědnosti se nepřekrývají.
- `oversizedFiles` ani `chunking` se v degradované návratovce nevyplňují (při selhání čtení
  je neznáme); obě pole jsou v `AiReport` nepovinná → tvar zůstává validní.

## Ověření
- `npm run typecheck` zelený.
- Celá sada `vitest run`: **643 testů / 59 souborů zelené.**
- Verze JSON indexu se NEZVEDLA (tvar `AiReport` se nemění) – `jsonIndex.test.ts` zelený.

## Pozn. pro člověka
Žádné vizuální/UX věci k ručnímu ověření – vše ověřitelné mechanicky a ověřeno. Auto-commit
fáze proběhne přes `mini done`.

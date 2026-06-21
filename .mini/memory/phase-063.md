# Phase 63 — Render ceny přeskočených AI částí

**Goal:** Když skipped AI stav nese strukturovanou costUsd/usage (provozní skip, co reálně stál tokeny), zobrazit tuto sečtenou cenu v markdown reportu (aiModeBlock + aiModeSummary) i na stderr (runOneAiMode); beznákladové skipy (chybí klíč, žádné non-goaly, síťová chyba) zůstanou beze změny (costUsd/usage undefined → nic se netiskne).

## Steps
- [done] aiModeBlock: cena u skipped s costUsd
- [done] aiModeSummary: cena u skipped s costUsd
- [done] runOneAiMode: cena na stderr u skipped
- [done] Test markdown se zuby
- [done] Test runOneAiMode se zuby
- [done] Zelený typecheck + testy + self-review

## Auto-commit
- Phase 63: Render ceny přeskočených AI částí

## Run report
---
phase: 63
verdict: done
steps:
  - title: "aiModeBlock: cena u skipped s costUsd"
    status: done
  - title: "aiModeSummary: cena u skipped s costUsd"
    status: done
  - title: "runOneAiMode: cena na stderr u skipped"
    status: done
  - title: "Test markdown se zuby"
    status: done
  - title: "Test runOneAiMode se zuby"
    status: done
  - title: "Zelený typecheck + testy + self-review"
    status: done
---

# Phase 63 — report z auto session

## Co se udělalo
Render sečtené ceny PROVOZNĚ přeskočeného AI běhu (skip s reálně naúčtovanými tokeny – model utnul výstup na `max_tokens` nebo vrátil prázdno) na třech místech:

- **`src/report/markdown.ts` – `aiModeBlock`** (skipped větev): za řádek důvodu se nově přidá řádek `_I tak naúčtováno: tokeny X vstup + Y výstup, odhad ceny ~$Z._`, ale JEN když `ai.costUsd !== undefined`. Tokeny se přidají, jen když existuje `ai.usage` (obranný guard pro případ ceny bez usage).
- **`src/report/markdown.ts` – `aiModeSummary`** (skipped větev): souhrn `- AI (label): přeskočeno` dostane suffix ` (~$Z)`, jen když `costUsd !== undefined`.
- **`src/cli.ts` – `runOneAiMode`**: funkce vyexportována (kvůli testu) a do skip větve přidán výpis na stderr `AI analýza … přeskočena, ale částečně naúčtována: tokeny … odhad ceny ~$Z.`, jen když `status.costUsd !== undefined`.

Klíčové rozhodnutí: podmínka je `costUsd !== undefined`, NE truthy check – aby se `costUsd: 0` nespolklo a zachovalo se rozlišení „nestálo nic" (undefined → ticho) vs „stálo $0" (0 → `~$0.0000`). Beznákladové skipy (chybí klíč, žádné non-goaly, síťová chyba) nechávají pole undefined, takže nic netisknou – beze změny.

## Testy
- `src/report/markdown.ai.test.ts`: +2 testy – skipped s `{costUsd, usage}` → blok i souhrn ukazují cenu i tokeny; skipped BEZ ceny (reálný `detectAiStatus({})`) → marker `~$` se nikde neobjeví.
- `src/cli.runoneaimode.test.ts`: nový soubor – injektovaný `call` do REÁLNÉ `runOneAiMode`; skipped s cenou → stderr přizná cenu+tokeny, skipped bez ceny → žádné `~$`.

Zuby ověřeny empiricky: dočasné vyříznutí render-větve (blok i stderr) testy shodilo, po obnovení zelené.

## Stav ověření
- `npx tsc --noEmit` – bez chyb.
- `npx vitest run` – 60 souborů, 653 testů zelených.
- Nezávislý self-review sub-agentem (čerstvý kontext): potvrdil správnost na všech bodech checklistu (rozlišení undefined vs 0, guard usage, zuby testů, žádná regrese, jednotná přesnost `toFixed(4)`).

## INDEX_VERSION
Nebumpováno záměrně – mění se jen render (markdown + stderr), tvar JSON výstupu (`AiStatus`) zůstává beze změny.

## Otevřené / mimo rozsah
- Self-review našel drobnou asymetrii v `src/analyze/aiAnalyze.ts:89-92`: `input_tokens ?? 0` chrání proti null, `output_tokens` ne. Za dodrženého typového kontraktu SDK (`output_tokens: number`) je `~$NaN` nedosažitelný, takže to NENÍ bug této fáze. Případná oprava (`output_tokens ?? 0`) patří do samostatné fáze, ne sem – nezanesl jsem ji, abych nemíchal rozsahy.

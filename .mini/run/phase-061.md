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

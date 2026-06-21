---
phase: 62
verdict: done
steps:
  - title: "Rozšířit AiStatus.skipped o usage?/costUsd?"
    status: done
  - title: "run*Analysis: provozní skip nese cenu strukturovaně"
    status: done
  - title: "runChunkedMode: započítat cenu i ze skipped částí"
    status: done
  - title: "Bump INDEX_VERSION 18 → 19"
    status: done
  - title: "Zelený typecheck + testy + self-review sub-agentem"
    status: done
---

# Phase 62 — report z auto session

## Co se udělalo
Provozně přeskočená AI část (model utnul výstup na `stop_reason=max_tokens` nebo vrátil
prázdno – API už proběhlo a naúčtovalo tokeny) teď nese cenu i **strukturovaně**, ne jen
v textu `reason`. Orchestrátor krájeného běhu (`runChunkedMode`) ji sečte do sloučené
`costUsd`, takže krájený běh cenu nepodstřeluje.

- `aiStatus.ts`: varianta `skipped` rozšířena o nepovinné `usage?`/`costUsd?` (+ doc).
- `aiResult.ts`: ve všech 3 funkcích (`runAiAnalysis`/`runAiCodeAnalysis`/`runAiLogicAnalysis`)
  větev max_tokens/prázdný výstup vrací do skipped i `usage` a `costUsd` (cena se počítá
  týmž `computeCostUsd`, žádný duplikát čísla). Text reason zůstal.
- `aiChunkedRun.ts`: skipped větev přičítá usage/costUsd, když je nese; do TÝCHŽ
  akumulátorů → správně se promítne do sloučeného `analyzed` (míchaný běh) i do výsledného
  `skipped` (všechny části utnuté). Flag `skippedCost` rozliší, jestli výsledný skipped má
  pole nést, nebo je nechat `undefined` (beznákladové skipy).
- `jsonIndex.ts`: bump `INDEX_VERSION` 18 → 19 + historie v doc komentáři.

## Testy (mají zuby)
- `aiResult.test.ts`: u všech 3 funkcí max_tokens/prázdný výstup ověřuje `usage` i
  `costUsd === computeCostUsd(usage, model)`; beznákladové skipy (žádné non-goaly, síťová
  chyba) ověřují `usage`/`costUsd` = undefined.
- `aiChunkedRun.test.ts`: nový helper `skippedWithCost`; testy přes REÁLNÝ `runChunkedMode`:
  (a) míchaný analyzed + skipped-s-cenou → sloučená cena = součet obou; (b) všechny
  skipped-s-cenou → výsledný skipped nese nasčítanou cenu; (c) míchané skipy (nákladový +
  beznákladový) → jede jen cena nákladové.
- `jsonIndex.test.ts`: verze 19 + průchod skipped s usage/costUsd 1:1.
- Ověřeno mutací: vyříznutí akumulace skipnuté ceny v orchestrátoru shodí 3 testy.

Typecheck zelený, celá suite **649 testů zelených**.

## Self-review (nezávislý sub-agent, čerstvý kontext)
Potvrdil čistou sčítací logiku: žádný double-count (každá část je v jedné větvi přes
`else if`), správné rozlišení „nestálo nic" vs „$0" (prošel všechny skipped návraty),
testy mají zuby. Našel:
- **P2 (render, mimo rozsah fáze):** strukturovaná cena se uživateli nikde nezobrazí –
  markdown i stderr u skipnutého běhu ukazují jen text reason. Pro „všechny části utnuté"
  je v markdownu cena z jednoho (deduplikovaného) reasonu, kdežto správný součet leží
  jen v JSON. → přesunuto do `verify` jako kandidát na follow-up fázi. Bylo vědomě
  odloženo už v diskusi (fáze míří na accounting v datech, ne render).
- **P3 (vyřešeno):** chyběl test průchodu skipped-s-cenou v jsonIndex → doplněn.

## Rozhodnutí k zaznamenání
Žádná zásadní křižovatka navíc oproti diskusi (tvar = rozšířit skipped, sloučený skipped
nese cenu, bump 19) – ADR netřeba. Otevřená věc je jen render (P2) – to je spíš nová fáze
než decision.

---
phase: 51
verdict: done
steps:
  - title: "Čistá funkce odhadu ceny + formátování + test"
    status: done
  - title: "Vlajka --ai-yes v parseArgs + HELP + test"
    status: done
  - title: "Práh + rozhodovací brána v cli.ts"
    status: done
  - title: "Testy rozhodovací brány (happy + unhappy)"
    status: done
  - title: "Nezávislý self-review + zelená sada"
    status: done
verify:
  - title: "Reálný placený AI běh: obklopuje odhadovaný rozsah skutečnou cenu?"
    detail: "Vstupní heuristika je 3,3 znaku/token (konzervativní), výstup je čistý worst-case (strop modelu). Jestli reálná cena padne dovnitř rozsahu 'řádově X až nejvýš Y' prokáže až placený běh – mechanicky neověřitelné. Doporučuju jeden malý glm běh (--ai-code) a porovnat hlášenou cenu po doběhu s odhadem před během."
  - title: "UX prahu u glm na reálném projektu (viz nález #9 níže)"
    detail: "Worst-case strop glm (65536 tok.) masivně nadhodnocuje – 2 režimy glm přelezou práh i na prázdném vstupu, ač reálná cena je centy. Posoudit, jestli brána neobtěžuje dotazem/skipem u levných glm běhů."
---

# Phase 51 — report z auto session

## Co je hotové
Před AI během se teď VŽDY vypíše přibližný odhad ceny (rozsah „řádově $X až nejvýš $Y", explicitně označený jako odhad, ne fakturace) a nad prahem $0.50 (porovnává se worst-case horní mez) se buď zeptá (TTY), nebo čistě přeskočí (ne-TTY / odmítnutí / EOF), nebo proběhne bez ptaní (`--ai-yes`).

- **`src/analyze/aiEstimate.ts`** (nový) – čistá `estimateAiCost(payload, model, modeCount)` + `formatCostEstimate`. Ceník i strop bere z `AI_PROVIDERS` (žádný duplikát). Vstup i výstup se násobí `modeCount` (každý režim posílá celý payload znovu). Konstanty `CHARS_PER_TOKEN=3.3`, `OUTPUT_MIN_TOKENS_PER_MODE=2000` (dokumentované).
- **`src/args.ts`** – vlajka `--ai-yes` (`aiYes: boolean`).
- **`src/cli.ts`** – konstanta prahu `AI_COST_CONFIRM_THRESHOLD_USD=0.5` (exportovaná kvůli testu) + brána v `runAiLayer` mezi sestavením payloadu a běhy. Skip vrací `kind:"skipped"` jen vyžádaným režimům, nevyžádané zůstávají `ready`. HELP doplněn o `--ai-yes`.
- Testy: `aiEstimate.test.ts` (8), `cli.aicost.test.ts` (9 – brána e2e + přímý test hranice prahu proti reálné `estimateAiCost`), `args.test.ts` rozšířen. Upraven jeden existující dvourežimový test v `cli.ai.test.ts` (přidán `--ai-yes`, viz níže).

## Ověřeno mechanicky
- Celá sada: **592 testů zelených** (57 souborů).
- `tsc -p tsconfig.json` (src): exit 0.
- `tsc -p tsconfig.test.json`: 45 chyb PŘED i PO mých změnách (změřeno přes `git stash`) → todo 18 flood jsem **nezhoršil**, moje nové soubory přidávají 0 typových chyb.
- Nezávislý sub-agent (čerstvý kontext) prošel checklist 1–10: žádný blokující nález.

## Na co narazit / co řešit dál
1. **Nález #9 (návrhový, ne bug): práh vázaný na worst-case dělá glm „upovídaným".** Strop glm je 65536 tok., takže 2 režimy glm přelezou práh $0.50 i s NULOVÝM vstupem (jen ze stropu výstupu ≈ $0.58), ač reálná cena je řádově centy (thinking jede na `reasoningEffort:low`, JSON je malý). Naopak opus 1 režim proklouzne pod práh i na ~60k znaků. Důsledek: u glm bude `--ai-yes` skoro povinné. Bylo to vědomé rozhodnutí z diskuze (worst-case = co může překvapit účet), ale stojí za zvážení vázat práh spíš na střední/vážený odhad. **Kandidát na nový mini:todo.**
2. **Zuby testu na hranici prahu** (sub-agent nález #2) – doplněno: `cli.aicost.test.ts` teď testuje přímo, že 1 režim opus < práh a 2 režimy > práh proti reálné `estimateAiCost`, aby refaktor ceníku/stropu hranici neposunul tiše.
3. **Upravený cizí test:** dvourežimový `--ai-non-goal --ai-code` test v `cli.ai.test.ts:307` dostal `--ai-yes`. Jeho účel je zapojení analýzy (analyze 2×, payload čten jednou), ne brána; bez vlajky by ho nová brána (worst-case $0.80 > práh) v ne-TTY přeskočila. Není to oslabení – test pořád hlídá totéž, jen potvrdí cenu.

## Limity (záměrné)
- Odhad je hrubá heuristika, ne fakturace – worst-case výstup je čistý strop modelu (model reálně skoro nikdy nezapíše plný strop). Přesnost prokáže až placený běh (viz `verify`).
- Per-model vstupní strop (todo 19) ani krájení velkých projektů tato fáze neřeší – jen odhad + bránu. To byl smysl pořadí: odhad ceny PŘED zvedáním vstupního stropu.

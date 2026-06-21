# Phase 51 — Odhad ceny AI před během

**Goal:** Před voláním API spočítat přibližný počet vstupních a (worst-case) výstupních tokenů × ceník zvoleného modelu, zobrazit odhad rozsahu ceny a počkat na potvrzení uživatele (s vlajkou pro přeskočení v neinteraktivním běhu).

## Steps
- [done] Čistá funkce odhadu ceny + formátování + test
- [done] Vlajka --ai-yes v parseArgs + HELP + test
- [done] Práh + rozhodovací brána v cli.ts
- [done] Testy rozhodovací brány (happy + unhappy)
- [done] Nezávislý self-review + zelená sada

## Auto-commit
- Phase 51: Odhad ceny AI před během

## Discussion
# Phase 51 — Odhad ceny AI před během

## Intent
Před voláním AI API ukázat uživateli přibližný odhad ceny a nechat ho běh potvrdit, aby
větší vstup / dražší model nebyl tichým překvapením na účtu. Motivace: dnes se cena počítá
až PO běhu (`computeCostUsd` v `src/analyze/aiResult.ts:186`); orchestrace v `src/cli.ts:535–578`
postaví payload a rovnou pustí každý vyžádaný režim bez jakékoli brzdy. Tato fáze je
předpoklad pro pozdější zvednutí vstupního stropu (todo 19) — bez odhadu by větší okno = past.

## Key decisions
- **Forma odhadu: rozsah min–max.** Vstup spočítat heuristikou (známe, kolik kódu posíláme),
  výstup podat jako rozpětí „řádově X až nejvýš Y $". U čísla EXPLICITNĚ napsat, že jde o
  odhad, ne fakturaci. Žádné jedno „přesné" číslo (budí falešnou jistotu, kterou heuristika nemá).
- **Žádná tokenizer knihovna.** Zůstat u heuristiky znaky/token (dnes ~3,3 znaku/token v
  `aiPayload.ts:30`, konzervativní = spíš nadhodnocuje). Důvody: (1) největší nejistota je
  VÝSTUP, ten žádný tokenizer nepředpoví; (2) `ai-tokenizer` má `claude` encoding, ale NE pro
  GLM-5.2 (jiný tokenizer Z.ai) → u glm bys stejně padl na heuristiku; (3) dep navíc + cizí
  ceník rozcházející se s `AI_PROVIDERS`. Pozn. z GLM docs: 1 token ≈ 0,75 angl. slova ≈ 1,5
  čín. znaku (pro kód ~4–4,5 znaku/token). Poměr se liší podle modelu i jazyka → jedno číslo
  bude vždy vedle, proto rozsah.
- **Ptát se jen nad práh** (např. ~$0.50). Pod prahem AI běží rovnou (netřeba potvrzovat pár
  centů). Práh se porovnává proti HORNÍ MEZI (worst-case), protože to je to, co může překvapit.
- **Ne-TTY bez vlajky → čistě přeskočit AI.** `AiStatus.kind = "skipped"` s důvodem ve smyslu
  „běh není interaktivní, potvrzení ceny nelze získat — přidej --ai-yes". Report vznikne, exit 0
  (sedí na success criterion „AI vrstva se čistě přeskočí"). NE pád, NE proběhnout bez ptaní.
- **Vlajka `--ai-yes`** = potvrzení předem (běží vždy bez dotazu). Doporučeno: odhad i tak
  VYPSAT (ať uživatel cenu vidí), jen nečekat na potvrzení.
- **Kombinovaná logika:** pod prahem → běž; nad prahem + TTY → ukaž odhad a čekej na potvrzení;
  nad prahem + ne-TTY + bez vlajky → čistě přeskoč; `--ai-yes` → běž vždy (odhad vypiš).
- **Infrastruktura už existuje** — `RunDeps` v `cli.ts:171` nese `ask` (`AskFn`) i `isInteractive`
  (dnes je používá interaktivní sběr záměru přes `readlineAsk`/`intentPrompt`). REUSE, nestavět nic
  nového. Test si podstrčí fake `ask` + `isInteractive`, ostrý běh jde přes `bin.ts`.

## Watch out for
- **Výstupní nejistota dominuje.** Worst-case výstup = `AI_PROVIDERS[model].maxTokens` × počet
  vyžádaných režimů (16k opus/sonnet, 64k glm). Spodní mez výstupu zvolit realisticky (ne 0).
  Pro glm bude horní mez velká — proto je forma rozsah, ne jedno číslo.
- **Vstup se posílá KAŽDÝM režimem zvlášť.** Payload se sice staví jednou, ale non-goal/code/logic
  jsou samostatná API volání, každé posílá CELÝ payload → vstupní cena se násobí počtem režimů,
  ne jen výstupní. Odhad to musí započítat (vstup × N + součet výstupů), jinak podhodnotí.
- **thinking se účtuje jako výstup; system prompt + JSON schéma přidávají vstup.** Heuristika je
  nepokryje přesně — worst-case výstup ať vychází z `maxTokens` (ten thinking zahrnuje).
- **Práh je skrytá konstanta** — zdokumentovat jako kontrakt (proč 0.50), ne tichý magický literál.
- **Potvrzení: default NE.** Prázdná odpověď / EOF (`ask` vrací `null` po Ctrl-D, viz `readlineAsk.ts`)
  = neproběhne (bezpečné). Jen explicitní „a/ano/y" potvrdí.
- **Nikdy nevisí:** dotaz spustit JEN když `isInteractive === true`. Bez `ask`/ne-TTY se neptat.
- **Adversarial / unhappy path:** prázdný payload (žádné zdrojové soubory) → odhad ~0 → pod prahem
  → běží (OK). Ověřit, že odhad nepadá na dělení nulou / NaN při 0 souborech nebo 0 znacích.
- **Cena je čistá funkce** — `estimateAiCost(payload, model, modes)` ať je testovatelná bez
  CLI/stdin (zuby: per-model ceník, násobení režimy, horní vs spodní mez), gate v cli.ts zvlášť.

## Run report
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

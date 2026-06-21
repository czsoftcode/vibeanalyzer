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

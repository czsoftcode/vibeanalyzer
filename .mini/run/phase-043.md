---
phase: 43
verdict: done
steps:
  - title: "CLI: --ai + výběr modelu --ai-model + test"
    status: done
  - title: "Sběr payloadu z projektu pod stropem (čistý modul) + test"
    status: done
  - title: "Reálný AI dotaz na non-goaly: prompt + JSON schema + SDK call"
    status: done
  - title: "Zpracování výsledku: parse → Finding[] + kontrola místa + cena (čisté funkce) + testy"
    status: done
  - title: "AiStatus.analyzed + zapojení do cli.ts + degradace + cena na stderr"
    status: done
  - title: "Report: analyzed v JSON (verze 13) i markdownu + testy"
    status: done
  - title: "Doběh: tsc + suite + reálný běh (měření) + nezávislý sub-agent"
    status: done
---

# Phase 43 — report z auto session

## Co se udělalo
Poprvé jde reálný kód + záměr na Claude. Za novým opt-in `--ai` se vybrané zdrojové
soubory pošlou na zvolený model (opus/sonnet), vrátí se strukturované nálezy porušení
non-goalů a hlavně se ZMĚŘÍ skutečná spotřeba tokenů + cena.

- **`aiPayload.ts`** (nový): `collectAiPayload` – vybere zdrojové soubory (bez
  minifikátů/binárek/velkých), slepí pod char stropem (200k), zachytí počty řádků,
  přizná uříznutí (`truncated`).
- **`aiResult.ts`** (nový, PURE): model ID + cenová tabulka (opus 5/25, sonnet 3/15),
  JSON schéma, system prompt, `buildAnalyzePrompt`, `parseFindings`, `toFindings`
  (levná kontrola místa), `computeCostUsd`, `runAiAnalysis` (orchestrátor, analyze
  /classify injektované).
- **`aiAnalyze.ts`** (nový, SDK): `realAiAnalyze` – `output_config.format` (structured
  outputs), adaptive thinking. **STREAMING** (`messages.stream().finalMessage()`),
  `maxRetries: 0`, prakticky neomezený timeout (30 min pojistka) – viz zjištění níže.
- **`aiStatus.ts`**: `AiModelChoice`, `AiUsage`, varianta union `analyzed`.
- **`args.ts`**: `--ai`, `--ai-model <opus|sonnet>` (default opus).
- **`cli.ts`**: větev `--ai` (klíč PŘED čtením souborů, dynamický import SDK/orchestrátoru,
  degradace, cena na stderr). **`findings.ts`**: zdroj `"ai"`. **JSON 12→13**, markdown
  větev `analyzed`.

## Ověření (mechanické, vše hotovo mnou)
- `tsc` čistý; **470 testů passed** (55 souborů; vč. 5 testů streamovacího `realAiAnalyze`
  přes mock SDK).
- Unit/integr.: payload (filtry, uříznutí, počet řádků vč. koncového \n a prázdného
  souboru), aiResult (prompt, parse vč. unhappy, kontrola místa, cena pro oba modely,
  orchestrátor: chybějící klíč/non-goaly/soubory/síť/parse-fail/únik klíče), args
  (--ai, --ai-model, neznámý model chybuje), e2e cli (--ai s fake analyze → analyzed
  v JSON+md, prompt nese kód+non-goal, cena na stderr, klíč neunikne; --ai bez klíče
  → skipped+hláška+exit 0).
- **REÁLNÉ MĚŘENÍ na tomhle projektu (smysl fáze):**
  - **opus-4.8**: 93 126 vstup + 1 065 výstup tokenů → **~$0,49**, 0 nálezů.
  - **sonnet-4.6**: 73 307 vstup + 7 465 výstup tokenů → **~$0,33**, 0 nálezů.
  - 0 nálezů je správně: analyzovaný projekt své non-goaly neporušuje (čte, nespouští;
    žádný web; atd.). Payload byl u obou uříznut na stropu (analýza neúplná, přiznáno).

## Adversarial self-review
Nezávislý sub-agent (čerstvý kontext) projel checklist (exit kódy, rozsah catch, zuby
testů, kontrakty, únik klíče/kódu, unhappy path, dosažitelnost). Žádný [VÁŽNÉ] nález.
Jediný [DROBNÉ]: `lineCount` počítal soubor s koncovým `\n` o +1 (kontrola místa pak
o řádek volnější) → opraveno (`countLines`, prázdný soubor = 0) + přidány testy se zuby.

## Důležitá zjištění z měření (vstup pro fázi 5c)
1. **Cenová past retry × timeout (~$1 za nic):** první sonnet běh měl `maxRetries: 2`
   + 120 s timeout. Sonnet+thinking nad 93k tokeny potřebuje víc než 120 s, takže SDK
   poslal požadavek 3×; server pokaždé naúčtoval (~$1 celkem), klient výsledek pokaždé
   zahodil → `skipped` bez dat. **Klientský timeout neruší serverové účtování.**
   Řešení (na podnět uživatele „neplatit za nic"): `maxRetries: 0` + **přechod na
   STREAMING**. Holý velký timeout nestačí – nestreamované dlouhé spojení může utnout
   infrastruktura kvůli nečinnosti (server dokončí + naúčtuje, klient nedostane nic).
   Streaming drží spojení živé průběžnými tokeny → žádný útes, žádné účtování za
   zahozený výsledek. Timeout 30 min je už jen krajní pojistka proti úplně mrtvému
   spojení.
4. **Bug nalezený živým ověřením před releasem (a opravený):** sonnet `--ai` padal na
   `JSON.parse("")` (SyntaxError → stack dump). Příčina: adaptive thinking sežral
   `max_tokens: 8000` DŘÍV, než stihl vypsat JSON → prázdná odpověď. Opraveno dvojitě:
   (a) `max_tokens` 8000 → 16000 (thinking + JSON se vejdou), (b) uříznutý/prázdný výstup
   (`stop_reason=max_tokens` nebo prázdný text) = ČISTÝ skip s důvodem a NAÚČTOVANOU
   cenou, ne pád se stackem (provozní stav, ne programová chyba). **Ověřeno živě po
   opravě:** sonnet 71 487 + 6 581 tok → ~$0,31, `analyzed` (předtím pád). Streaming tím
   ověřen i proti živému API.
2. **Tokeny jsou závislé na modelu:** stejný payload = 93k (opus) vs 73k (sonnet) – jiný
   tokenizer. Heuristika znaky÷4 (ani fixní poměr napříč modely) NEPLATÍ.
3. **Adaptive thinking je nepředvídatelné v ceně:** opus 1 065 vs sonnet 7 465 výstupních
   tokenů za stejný úkol (thinking se účtuje jako výstup). Páka pro 5c: zvážit thinking
   vypnout pro pouhou extrakci – levnější/rychlejší za cenu kvality.

## Pozn. pro člověka
- `analyzed` = „analýza non-goalů proběhla", NE „kód je bez chyb". 0 nálezů = nenašlo
  porušení non-goalů v POSLANÉ (uříznuté) části.
- Logika/obecný kód (ne jen non-goaly) je v backlogu jako todo na rozšíření.
- Doporučuji `/mini:decision` na zaznamenání rozhodnutí `maxRetries: 0` + 300 s (proč
  retry timeoutu škodí – platí se vícenásobně za zahozený výsledek).

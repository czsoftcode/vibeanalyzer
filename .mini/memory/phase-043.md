# Phase 43 — Reálná AI analýza + měření nákladů

**Goal:** První měřitelný kus fáze 6: poslat ohraničenou část projektu (žádné krájení na desítky částí) spolu se záměrem z project.md na opus-4.8 a vrátit strukturované nálezy, každý mířící na konkrétní místo v kódu (file:line, obrana proti halucinaci – zatím tvrzené místo, plné ověření existence řádku až následně). Hlavní výstup: zaznamenat a zobrazit SKUTEČNOU spotřebu tokenů (z usage v odpovědi API) a spočítanou cenu – empirický základ pro pozdější odhad (fáze 5c). Analytický model opus-4.8 (ping zůstává haiku). Testy mockují SDK a ověří jen zapojení (prompt se složí, usage se zachytí, cena se spočítá, odpověď se naparsuje), ne konkrétní nálezy; reálné měření je ruční běh (testuje se na tomhle projektu – není rozsáhlý). Drahá cesta zůstává opt-in (za --ai-check nebo obdobnou bránou), aby default běh dál neutrácel.

## Steps
- [done] CLI: --ai + výběr modelu --ai-model + test
- [done] Sběr payloadu z projektu pod stropem (čistý modul) + test
- [done] Reálný AI dotaz na non-goaly: prompt + JSON schema + SDK call
- [done] Zpracování výsledku: parse → Finding[] + kontrola místa + cena (čisté funkce) + testy
- [done] AiStatus.analyzed + zapojení do cli.ts + degradace + cena na stderr
- [done] Report: analyzed v JSON (verze 13) i markdownu + testy
- [done] Doběh: tsc + suite + reálný běh (měření) + nezávislý sub-agent

## Auto-commit
- Phase 43: Reálná AI analýza + měření nákladů

## Discussion
# Phase 43 — Reálná AI analýza + měření nákladů

## Intent
První měřitelný kus fáze 6. Poprvé poslat reálný kód projektu + záměr (z project.md)
na Claude a dostat zpět strukturované nálezy mířící na konkrétní místo v kódu. HLAVNÍ
cíl není dokonalý nález, ale ZMĚŘIT reálnou spotřebu tokenů (z `usage` v odpovědi) a
cenu – empirický základ pro odhad ve fázi 5c. Testuje se na tomhle projektu (malý).

Stav po fázi 42: AI vrstva má jen levný ping za `--ai-check` (`aiPing.ts`,
`verifyAiAccess`, `AiStatus = skipped|ready|verified`). Kód projektu se nikam neposílá –
scan dává jen strom (cesty/velikosti), NE obsahy. Tahle fáze musí poprvé číst obsahy
vybraných souborů a sestavit z nich payload. `Finding` (src/findings.ts) je sdílený tvar
nálezu (source/severity/volitelné file/line/column/rule/message); AI se nabalí přidáním
zdroje `"ai"` do `FindingSource`. `Intent` (src/intent.ts) nese `building` (záměr) a
`nonGoals: string[]|null`.

## Key decisions
- **Spouštění: nový přepínač `--ai`** (reálná analýza). `--ai-check` zůstává levný ping
  (oddělené záměry: „ověř, že to jede" vs „utrať za analýzu"). `--ai` vyžaduje klíč
  stejně jako `--ai-check`; bez klíče → `skipped` + stejná stderr hláška (AI_KEY_HINT).
- **Volba modelu na CLI** (uživatel si vybere sonnet vs opus). Mechanika do plánu, návrh:
  `--ai-model sonnet|opus` nebo hodnotová forma `--ai=opus`; default `opus` (claude-opus-4-8).
  NENÍ to konfigurák (non-goal) – je to CLI přepínač. Cenová tabulka musí pokrýt OBA
  modely: opus-4-8 = $5/$25 za MTok (vstup/výstup), sonnet-4-6 = $3/$15.
- **Rozsah prvního kusu: JEN non-goaly.** Hledá porušení deklarovaných non-goalů; každý
  nález ukazuje na KTERÝ non-goal (success criterion: non-goal nálezy se vážou na
  deklarované non-goaly). Logika/obecný kód → samostatné todo na rozšíření (přidat po
  discuss). Sedí na ověření z todo 2: „projekt porušující non-goal dostane nález".
- **Strukturovaný výstup přes `output_config.format` (JSON schema).** Garantuje
  parsovatelný tvar, žádné křehké tahání JSON z textu. opus-4.8 i sonnet-4.6 to umí.
  Trade-off: nekompatibilní s citacemi (nepoužíváme), jednorázová latence kompilace schématu.
- **Levná kontrola halucinace:** po naparsování u každého nálezu ověřit, že `file` je
  v POSLANÉM setu a `line` ≤ počet řádků toho souboru (obsah máme – sami jsme ho poslali);
  jinak nález označit jako „místo neověřeno". Plné sémantické ověření až později.
- **Tvar úspěchu:** `AiStatus` dostane variantu `analyzed` s payloadem
  `{ model, findings: Finding[], usage: {inputTokens, outputTokens, …}, costUsd }`.
  → bump JSON indexu 12 → 13. Nálezy se vykreslí stejnou cestou jako strojové.
- **Cena z `usage`:** `(inputTokens/1e6)*cenaVstup + (outputTokens/1e6)*cenaVýstup`.
  Zobrazit v reportu (.md sekce) i na stderr. Cache tokeny u jednorázové analýzy ~0,
  stačí vstup+výstup (case ošetřit, kdyby `usage` cache pole neslo).
- **Parametry reálného callu (NE jako ping):** štědrý timeout (analýza s adaptive
  thinking může trvat desítky sekund – návrh ~120 s), `maxRetries` 1–2 (transientní
  429/5xx u reálného běhu retryovat dává smysl), non-streaming, `max_tokens` ~4–8k na
  nálezy, adaptive thinking zapnuté.

## Watch out for
- **Co se pošle a OHRANIČENÍ:** vybrat zdrojové soubory (.ts/.js/.tsx/.jsx…) bez
  minifikátů/binárek/velkých (stejné filtry jako jinde), přečíst obsahy a sloučit s
  hlavičkami cest, ale POD tokenovým/char stropem (jeden payload, žádné krájení na
  desítky částí). Na tomhle projektu se to vejde; u většího by se uřízlo + přiznalo v
  reportu (ne tiché uříznutí). Strop = konstanta.
- **Degradace jako u pingu:** síť/timeout/401 → `skipped` s důvodem, exit 0, report se
  vyrobí. Nečekaná chyba (špatný tvar, TypeError) → probublá se stackem, na hranici CLI
  degraduje (vypíše stack), NESMÍ se maskovat jako čistý „skipped".
- **Klíč se NESMÍ dostat do reportu ani na stderr** (stejně jako dosud). Pozor i na to,
  aby se do `.md`/`.json` nedostal OBSAH kódu nad rámec nálezů (posíláme kód do API, ale
  do reportu patří jen nálezy + usage + cena).
- **Determinismus:** reálné API vrací pokaždé jiné nálezy → testy mockují SDK a ověří jen
  ZAPOJENÍ (prompt obsahuje záměr+kód, `usage` se zachytí, cena se spočítá z usage,
  schéma se naparsuje, kontrola místa funguje, degradace na chybu). Konkrétní nálezy = ruční běh.
- **Cena měření:** i ohraničený běh na opus-4.8 stojí peníze; první ruční měření na tomhle
  (malém) projektu. Sonnet je levnější varianta pro porovnání.
- **Kontrola místa potřebuje obsah souborů, který jsme poslali** – držet ho v paměti do
  doby ověření (počet řádků), ne ho zahodit hned po složení promptu.
- **Vstupní body + kontrakty** (`--ai` v args.ts, JSON verze, union `analyzed`, prompt↔schema
  kontrakt) = před reportem pustit nezávislého sub-agenta (self-review čerstvým kontextem).
- **Todo na rozšíření:** logika/obecný kód jako AI nález – přidat do `mini todo` (uživatel
  to chce zaznamenat). Plus později plné ověření halucinací (sémantika, ne jen existence řádku).

## Run report
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

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

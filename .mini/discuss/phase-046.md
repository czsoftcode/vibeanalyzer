# Phase 46 — Větší vstupní strop AI (800k znaků)

## Intent
Dvě části:
1. Zvětšit celkový strop payloadu pro AI: `AI_PAYLOAD_CHAR_BUDGET` v
   `src/analyze/aiPayload.ts` z `200_000` na `800_000` znaků (~240k tokenů, hrubý odhad),
   aby se do AI vrstvy vešly i větší projekty (nad ~83k tokenů se dnes usekávají).
2. Přiznat v REPORTU (.md + JSON), které zdrojové soubory byly z AI payloadu vynechány
   kvůli per-file stropu (`AI_PAYLOAD_PER_FILE_MAX_BYTES`, zůstává 100k bajtů) – ať
   uživatel ví, co AI nevidělo. Konzistentní se skenerem tajemství (fáze 27).

## Key decisions
- **Hodnota stropu = 800_000 znaků** (uživatel zvolil; ~240k tokenů, pohodlná rezerva nad
  83k-tokenovým projektem; hluboko pod 1M kontextem modelu).
- **Per-file strop zůstává 100k bajtů** – nezvedat (ochrana proti jednomu obřímu souboru),
  ALE vynechané soubory se přiznají.
- **Oznámení o vynechaných souborech jen do reportu (.md + JSON)**, NE na stderr.
- **Char vs token je jen heuristika** (~3,3 znaku/token). Komentář to má říct – „800k znaků"
  není přesně „240k tokenů"; u hustého kódu může být i 250-280k tokenů. Pořád << 1M.
- **Odhad ceny před během stále chybí** (Fáze 5c / todo 7) a krájení velkých projektů je
  backlog. Tato fáze je vědomý MEZIKROK, ne náhrada – větší strop = větší TICHÝ náklad
  (sonnet ~$0,7 / opus ~$1,2 za 1 režim na projekt těsně pod stropem, dozvíš se až po
  doběhu). Přiznat v komentáři i reportu.

## Watch out for
- **Návrh přenosu `oversizedFiles` do reportu** (proberat v plánu): nejmenší plumbing je
  přidat `oversizedFiles: string[]` do `AiPayload` (populace v `collectAiPayload`) a pak
  ho protáhnout do reportu přes `AiReport` (nepovinné pole) – `AiReport` je jediný kanál
  AI dat do `buildJsonIndex`/`buildMarkdown`. Vědomý míchanec: je to payload-metadata, ne
  „režim", ale alternativa (samostatné pole přes MarkdownInput + buildJsonIndex args) je
  víc plumbingu. Zdůvodnit v reportu.
- **Co je „oversized":** jen soubory, které by JINAK byly AI kandidáti (zdrojová přípona,
  NE minifikát), ale `f.size > AI_PAYLOAD_PER_FILE_MAX_BYTES`. NEvypisovat minifikáty ani
  ne-zdrojové (ty nejsou AI kandidáti, byl by to šum).
- **Druhý bump JSON verze za sebou:** `INDEX_VERSION` 15 → 16 (změna tvaru `ai` = kontrakt
  s konzumenty JSON). Aktualizovat komentář + test verze.
- **Markdown:** poznámku o vynechaných souborech dát JEDNOU pod „## AI analýza" (sdílený
  vstup), ne do každého ze tří mode-bloků. Jen když je seznam neprázdný. Bez AI běhu se
  payload nestaví → `oversizedFiles` prázdné/undefined → žádná poznámka (správně).
- **Testy mají mít zuby:** truncation test (`aiPayload.test.ts:54`) počítá hranici
  RELATIVNĚ ke konstantě (`* 0.7`), takže po změně hodnoty projde beze změny – sám o sobě
  NECHYTÍ špatnou hodnotu. Přidat test, který oversized soubory reálně přizná (aiPayload +
  e2e cli.ai s velkým souborem → jeho cesta v reportu), a ověřit JSON verzi 16.
- **Per-file vynechání ≠ truncation tail.** Tato fáze řeší jen per-file oversized. Soubory
  uříznuté z TAILu po překročení celkového stropu se dál jen signalizují `truncated:true`
  (nejsou jmenovitě vypsané) – pojmenování tailu je možné budoucí vylepšení, NE součást
  této fáze (nerozšiřovat scope).

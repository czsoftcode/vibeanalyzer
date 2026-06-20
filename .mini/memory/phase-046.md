# Phase 46 — Větší vstupní strop AI (800k znaků)

**Goal:** Zvětšit AI_PAYLOAD_CHAR_BUDGET v src/analyze/aiPayload.ts z 200_000 na 800_000 znaků (~240k tokenů), aby se do AI vrstvy vešly i větší projekty (nad ~83k tokenů, které se dnes usekávají). Aktualizovat doprovodný komentář/odhad tokenů a testy stropu (truncation hranice). Sdílené všemi třemi AI režimy. POZOR: odhad nákladů před během stále chybí (Fáze 5c/todo 7) a skutečné řešení velkých projektů je krájení na části (backlog) – tato fáze je vědomý mezikrok, ne náhrada za ně; v reportu/komentáři to přiznat.

## Steps
- [done] Zvětšit celkový strop na 800k + komentář
- [done] Sbírat vynechané velké soubory v payloadu
- [done] Protáhnout oversizedFiles do AiReport + zapojit v cli
- [done] Render poznámky o vynechaných souborech v markdownu
- [done] Bump JSON verze 15 → 16 + průtok pole
- [done] Doběh fáze

## Auto-commit
- Phase 46: Větší vstupní strop AI (800k znaků)

## Discussion
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

## Run report
---
phase: 46
verdict: done
steps:
  - title: "Zvětšit celkový strop na 800k + komentář"
    status: done
  - title: "Sbírat vynechané velké soubory v payloadu"
    status: done
  - title: "Protáhnout oversizedFiles do AiReport + zapojit v cli"
    status: done
  - title: "Render poznámky o vynechaných souborech v markdownu"
    status: done
  - title: "Bump JSON verze 15 → 16 + průtok pole"
    status: done
  - title: "Doběh fáze"
    status: done
---

# Phase 46 — report z auto session

## Co je hotové
Dvě části:
1. **Větší celkový strop:** `AI_PAYLOAD_CHAR_BUDGET` 200_000 → **800_000** znaků
   (aiPayload.ts). Komentář přepsán: znaky ≠ tokeny (~3,3/tok, ~240k jako hrubý odhad,
   << 1M kontext), + přiznání, že odhad ceny před během chybí (Fáze 5c/todo 7) a krájení
   je backlog – tahle fáze je vědomý mezikrok, ne náhrada.
2. **Přiznání vynechaných velkých souborů:** `AiPayload.oversizedFiles: string[]` plní
   `collectAiPayload` (zdrojoví kandidáti – správná přípona, ne minifikát – nad per-file
   stropem 100k, který zůstává). Protaženo do reportu přes nepovinné
   `AiReport.oversizedFiles?` (jediný kanál AI dat do reportu; plní se jen v analytické
   větvi `runAiLayer`, kde se reálně stavěl payload). Markdown: poznámka JEDNOU pod
   „## AI analýza" (jen když neprázdné). JSON: `INDEX_VERSION` 15 → 16.

## Ověření (mechanické, sám)
- `tsc --noEmit`: čisté.
- Celá suite: **532 testů** zelená (+6: literální hodnota stropu, oversized výběr/jen
  zdroje/prázdné v aiPayload.test, render poznámky + prázdné→nic v markdown.ai.test,
  verze 16 + průtok pole v jsonIndex.test).
- **Budget efekt na REÁLNÉM projektu bez API nákladů** (dry-run `collectAiPayload`):
  tento projekt má 584 611 znaků (94 souborů) → při novém stropu 800k `truncated: false`
  (při starém 200k se usekával). Potvrzeno end-to-end na reálných datech, cena $0.
- **Oversized cesta přes REÁLNÝ report** (malý projekt, jeden soubor 126 046 bajtů):
  `big.ts` se objevil v `.md` poznámce pod „## AI analýza" i v JSON
  `ai.oversizedFiles: ["big.ts"]`; JSON verze 16; logic analyzed (~$0,0027); exit 0;
  velký soubor se ani nečetl (jen jméno cesty, žádný únik obsahu).
- Nezávislý sub-agent (čerstvý kontext): prošel 8 bodů (definice oversized, determinismus,
  payload→report kontrakt, render/jednoznačnost, JSON průtok+verze, hodnota stropu,
  regrese literálů, únik dat) — bez reálných nálezů.

## Na co dát pozor / co zůstává otevřené
- **Větší strop = větší tichý náklad.** Odhad ceny PŘED během pořád neexistuje
  (Fáze 5c / todo 7); u projektu těsně pod 800k zaplatíš ~$0,7 (sonnet) / ~$1,2 (opus)
  za jeden režim a dozvíš se to až po doběhu. Přiznáno v komentáři i reportu.
- **Skutečné řešení velkých projektů je krájení na části** (backlog) – nad 800k znaků se
  pořád usekává (s `truncated: true`). Tato fáze jen posouvá hranici.
- **Per-file vynechání ≠ truncation tail:** soubory uříznuté z konce po překročení
  CELKOVÉHO stropu se dál jen signalizují `truncated: true` (nejsou jmenovitě vypsané).
  Pojmenování tailu je možné budoucí vylepšení, vědomě mimo rozsah této fáze.

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

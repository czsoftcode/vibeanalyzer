---
phase: 45
verdict: done
steps:
  - title: "Přepínač --ai-logic v args.ts"
    status: done
  - title: "Logic vrstva v aiResult.ts"
    status: done
  - title: "Třetí pole logic v AiReport + bump JSON verze"
    status: done
  - title: "Render logic sekce v reportu"
    status: done
  - title: "Zapojení v cli.ts (runAiLayer)"
    status: done
  - title: "Doběh fáze"
    status: done
---

# Phase 45 — report z auto session

## Co je hotové
Třetí AI režim `--ai-logic` posuzuje funkčnost kódu jako CELEK vůči záměru
("What I'm building") z project.md a hlásí, kde se s ním rozchází. Strukturně paralela
`--ai-code`, ale se dvěma rozhodnutými odlišnostmi:

1. **Místo je nepovinné.** `LOGIC_FINDINGS_SCHEMA` má `file`/`line` mimo `required`.
   `toLogicFindings`: chybějící `file` = legitimní (žádná značka), `file` mimo poslaný set
   nebo `line` mimo rozsah = „[místo neověřeno]" (zahozeno), `file` v setu bez `line` =
   ověřený soubor bez řádku. Neověřené `file`/`line` se nikdy nedostanou do `Finding`.
2. **Brána je na záměru.** Pořadí v `runAiLogicAnalysis`: klíč → záměr (`intent.building`)
   → soubory → `payload.truncated` → teprve API. Bez záměru i při useknutí se režim čistě
   přeskočí PŘED placeným voláním (odvození záměru z kódu a krájení na části = budoucí fáze).

Zapojení: `args.ts` (`--ai-logic`, `ParsedArgs.aiLogic`) + help v `cli.ts`; `AiReport.logic`
(aiStatus.ts); JSON `INDEX_VERSION` 14→15; markdown nová sekce „Logika vs záměr (--ai-logic)"
s trvalým přiznáním aproximace (`AI_LOGIC_APPROX_NOTE`) + třetí řádek souhrnu; `runAiLayer`
nese `logic` ve všech 4 návratech `AiReport` a volá `runAiLogicAnalysis` přes `runOneAiMode`.
Logic prompt nese jen záměr, NE non-goaly (čistě oddělené režimy).

## Ověření (mechanické, sám)
- `tsc --noEmit`: čisté.
- Celá suite: 526 testů zelená (přidány unit testy schématu/parse/to/orchestrátoru v
  aiResult.test.ts, render v markdown.ai.test.ts, JSON verze+tvar v jsonIndex.test.ts,
  přepínač v args.test.ts, 2 e2e v cli.ai.test.ts).
- Reálný běh BEZ klíče na tomto projektu: exit 0, logic sekce s aproximací, `skipped`
  „chybí ANTHROPIC_API_KEY", JSON verze 15, `ai.logic` přítomné, klíč nikde.
- Reálný běh `--ai-logic --ai-model sonnet` na tomto (velkém) projektu: trefil truncation
  gate → `skipped` „kód se nevešel celý", analyze se NEzavolal → **cena $0** (potvrzeno
  reálně, ne jen mockem).
- Reálný placený běh na malém projektu se záměrem: `analyzed`, sonnet, usage 954+307
  tokenů, **~$0,0075**, 2 nálezy správně odhalily rozpor se záměrem (chybí odčítání, chybí
  CLI), míří na `calc.ts:1`/`:5` (ověřené místo), `rule="logika: chybí funkčnost"`, žádný
  únik klíče. Tím ověřena i analyzed cesta od konce do konce, ne jen mockem.
- Nezávislý sub-agent (čerstvý kontext): prošel 7 bodů (exit kódy, pořadí bran,
  ověření místa, prompt↔schéma, parse unhappy path, AiReport ve všech místech, neúnik
  tajemství) — bez reálných nálezů.

## Na co dát pozor / co zůstává otevřené
- **Obrana proti halucinaci je u logiky nejslabší ze tří režimů** (vědomé rozhodnutí):
  soud o celku se ověří jen částečně (místo často chybí nebo míří na celek). Zmírněno
  přiznáním aproximace v reportu, ale nevypnuto — uživatel bere nálezy jako vodítko.
- **Budoucí fáze** (stojí za vlastní todo): (1) krájení projektu na logické části, aby
  `--ai-logic` zvládl i velký/useknutý projekt (teď se přeskočí); (2) odvození záměru
  z kódu, když project.md chybí (nejrizikovější na halucinace).
- Sdílený `classifyAiError` stále nezná HTTP 529 overloaded_error (todo 12) — logic režim
  to dědí, mimo rozsah této fáze.

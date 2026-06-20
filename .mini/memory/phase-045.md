# Phase 45 — AI-logika vůči deklarovanému záměru

**Goal:** Přidat přepínač --ai-logic, který posoudí funkčnost kódu jako celek vůči záměru z project.md (vlastní prompt + schéma, nález míří co nejvíc na konkrétní místo, ale nemusí na jeden řádek), zapojí se jako třetí nezávislé pole do AiReport/reportu; když project.md chybí, režim se čistě přeskočí (odvození záměru z kódu je vyčleněno do pozdější fáze).

## Steps
- [done] Přepínač --ai-logic v args.ts
- [done] Logic vrstva v aiResult.ts
- [done] Třetí pole logic v AiReport + bump JSON verze
- [done] Render logic sekce v reportu
- [done] Zapojení v cli.ts (runAiLayer)
- [done] Doběh fáze

## Auto-commit
- Phase 45: AI-logika vůči deklarovanému záměru

## Discussion
# Phase 45 — AI-logika vůči deklarovanému záměru

## Intent
Třetí AI režim `--ai-logic` (vedle `--ai-non-goal` a `--ai-code`). Ptá se: dělá kód jako
CELEK to, co slibuje záměr z `project.md` ("What I'm building"), a kde se s ním rozchází?
Strukturně z ~80 % paralela `--ai-code` větve (vlastní schéma, prompt, parse/to funkce,
orchestrátor, třetí pole `logic` v `AiReport`, bump JSON verze, nová sekce v markdownu).

Dvě věci jsou jinak než u code/non-goal:
1. **Místo je NEPOVINNÉ.** Soud o celku nemusí mířit na jeden řádek. Chybějící místo je
   legitimní (NE značka "[místo neověřeno]"). Vyplněné místo se ověří stejným kontraktem
   (soubor v poslaném setu, řádek ≤ lineCount); špatné → "[místo neověřeno]".
2. **Brána je na záměru, ne na non-goalech.** Skip, když chybí `intent.building`.
   Odvození záměru z kódu (když project.md není) je VYČLENĚNO do pozdější fáze.

## Key decisions
- **Kontext modelu:** jen "What I'm building" (`intent.building`). Non-goaly se NEposílají
  (řeší je `--ai-non-goal`, čistě oddělené režimy, jinak duplicitní nálezy).
- **Useknutý kód (`payload.truncated`):** logic režim se ČISTĚ PŘESKOČÍ (`skipped` s důvodem).
  Soud o celku z neúplného vstupu je nespolehlivý. → Následná fáze musí vyřešit krájení
  projektu na logické části a kontrolovat je (jinak `--ai-logic` velký projekt nedostane).
- **Gate na záměru:** chybí `intent.building` (project.md není, NEBO je, ale sekce
  "What I'm building" chybí/prázdná) → skip s jasným důvodem. Konzistentní s tím, jak
  `runAiAnalysis` skipuje bez non-goalů a `runAiCodeAnalysis` bez souborů.
- **Tvar nálezu:** `file?` + `line?` nepovinné, `kind` (krátký druh: "chybí funkčnost",
  "rozpor se záměrem"), `severity` (error|warning|info), `message`. Do `Finding.rule`
  jako `logika: <kind>`.
- **Report:** třetí pole `logic: AiStatus` v `AiReport`; markdown sekce + JSON; bump
  `INDEX_VERSION`. V sekci VÝRAZNĚ napsat, že je to neúplná aproximace (slabší obrana
  proti halucinaci než u řádkových nálezů).
- **Opt-in:** default běh bez přepínače NESMÍ utrácet (gate jako ostatní AI režimy).

## Watch out for
- **Halucinace (nejvyšší ze tří režimů):** soud o celku se ověřuje nejhůř. Pojistka jen
  v promptu ("jen reálné rozpory, ne domněnky, radši méně") + přiznání aproximace v reportu.
  Přiznat, že obrana je slabší než u code/non-goal.
- **Sdílené mechanismy NEznásilnit:** `collectAiPayload`/`AiPayload`, `AnalyzeFn`,
  `computeCostUsd`, kontrola místa (soubor v setu, řádek ≤ lineCount) — znovupoužít, ale
  logic se odchyluje v nepovinném místě; ať se to neprojeví jako falešné "neověřeno".
- **Vstupní body + kontrakty → nezávislý sub-agent před reportem (čerstvý kontext):**
  `args.ts` (nový `--ai-logic` + `ParsedArgs.aiLogic`, help text L47-52), `cli.ts`/`cliMain.ts`
  zapojení, `AiReport` rozšíření, JSON `INDEX_VERSION`, markdown render, prompt ↔ schéma soulad.
- **Exit kódy / degradace:** bez klíče → skip BEZ síťového volání; známá chyba (síť/timeout/401,
  classifyAiError) → skip s důvodem; neznámá (parse/program) → probublá se stackem (nemaskovat).
  Žádná chybová cesta nesmí skončit falešný "analyzed".
- **Klíč ani obsah kódu se NESMÍ dostat do reportu/stderr** (jen nálezy + usage + cena).
- **classifyAiError nezná overloaded_error (HTTP 529)** — todo 12, sdílená vrstva; netýká se
  přímo této fáze, ale logic režim ji zdědí.
- **Následná fáze (zaznamenat do backlogu):** krájení projektu na logické části pro logic
  režim, aby velký/useknutý projekt dostal soud po částech. Plus odvození záměru z kódu,
  když project.md není (nejrizikovější na halucinace).

## Run report
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

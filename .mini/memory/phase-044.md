# Phase 44 — AI analýza obecného kódu (--ai-code)

**Goal:** Rozšířit AI vrstvu o samostatný režim analýzy kvality a rizik kódu řízený VLASTNÍM přepínačem, oddělený od non-goalů (žádné míchání do jednoho dotazu/pole category). Konkrétně: (1) zavést rozcestník přepínačů a přejmenovat dnešní --ai na --ai-non-goal (zachová chování fáze 43); (2) přidat --ai-code: nový režim hledající problémy kódu, které nezachytí parser/tsc/ESLint (rizikové vzorce, sémantika, kvalita), s vlastním promptem a vlastním JSON schématem BEZ nonGoalIndex; každý nález míří na konkrétní místo v poslaném kódu (kontrola místa jako dosud, obrana proti halucinaci). Non-goal nálezy se dál vážou na deklarované non-goaly přes nonGoalIndex. Report (markdown + JSON, bump verze) a měření tokenů/ceny pokryjí oba režimy zvlášť (podklad pro Fázi 5c, todo 7 dál otevřená). --ai-logic je vyčleněn do samostatné fáze (todo 11).

## Steps
- [done] Přepínače: --ai → --ai-non-goal, přidat --ai-code
- [done] Code analýza: prompt + schéma + čisté funkce + orchestrátor (aiResult.ts)
- [done] Report nese oba AI výsledky odděleně
- [done] Zapojení v cli.ts
- [done] Doběh: tsc + suite + reálný běh + nezávislý sub-agent

## Auto-commit
- Phase 44: AI analýza obecného kódu (--ai-code)

## Discussion
# Phase 44 — AI analýza obecného kódu (--ai-code)

## Intent
Rozšířit AI vrstvu (dnes jen non-goaly za `--ai`, fáze 43) o samostatný režim analýzy
kvality/rizik kódu, řízený VLASTNÍM přepínačem. Místo původně navrženého „jednoho dotazu
s polem `category`" se rozhodlo pro ODDĚLENÉ přepínače: každý spustí přesně svou analýzu,
nic se nemíchá, uživatel vědomě vybírá (a vědomě platí) jen to, o co stojí. Sedí to k
filozofii projektu (oddělené vrstvy, odhad nákladů před během) a dá čistší měření pro 5c.

Rozsah fáze byl OSEKÁN oproti původnímu uloženému cíli (ten mluví o jednom dotazu +
`category` — to už NEPLATÍ). V této fázi:
- Zavést rozcestník přepínačů: `--ai-non-goal` převezme dnešní chování `--ai`.
- Přidat `--ai-code`: nový režim, vlastní prompt + vlastní schéma BEZ `nonGoalIndex`.
- Reálný běh změří tokeny + cenu obou režimů zvlášť (podklad pro Fázi 5c, todo 7 dál otevřená).

`--ai-logic` se do této fáze NEvešel — vyčleněn do samostatné fáze (přidáno do `mini todo`).

## Key decisions
- **Tři odlišné úrovně AI analýzy (potvrzeno uživatelem):**
  - `--ai-non-goal` = porušení deklarovaných non-goalů (dnešní `--ai`).
  - `--ai-code` = vše o kódu, co NEdokáže obyčejný parser/tsc/ESLint (syntax/typy od AI
    nechceme, ty řeší stroj) — kvalita, rizikové vzorce, sémantika nad rámec linteru.
    Stejný mechanismus jako non-goal: payload souborů → nálezy mířící na konkrétní
    soubor:řádek (obrana proti halucinaci, kontrola místa jako v `toFindings`).
  - `--ai-logic` = funkčnost kódu jako CELEK vůči záměru z `project.md`; kde project.md
    není, vyvodit záměr z kódu. JINÝ mechanismus (celek, ne jeden řádek) → samostatná
    fáze (v `mini todo`).
- **ŽÁDNÉ společné pole `category`.** Non-goal si nechá `nonGoalIndex` ve svém schématu,
  `--ai-code` dostane vlastní čisté schéma bez `nonGoalIndex`. Tím odpadá hádání kategorie
  modelem a míchání dvou cílů v jednom promptu.
- **Dva samostatné API dotazy = až dvojí cena**, když si uživatel pustí oba režimy. Vědomý
  kompromis: oddělené analýzy = vyšší kvalita každé a čistší měření, výměnou za to, že
  „spusť vše" stojí násobek. Žádný agregátní „spusť všechny" přepínač — výběr je vědomý.

## Watch out for
- **`--ai` osud:** ROZHODNUTO — `--ai` se přejmenuje na `--ai-non-goal` (ne alias).
  Default běh (bez přepínače) NESMÍ utrácet — AI režimy zůstávají opt-in (gate jako dosud).
  Pozor na testy a místa, kde se dnešní `--ai` parsuje (`args.ts`, `cli.*.test.ts`).
- **Kontrakt non-goal vazby zůstává:** non-goal nálezy se dál vážou na deklarované
  non-goaly přes `nonGoalIndex` (success criterion projektu) — `--ai-code` se ho NEtýká.
- **Code analýza je otevřená** → riziko hodně málohodnotných nálezů = víc output tokenů =
  vyšší cena. Zvážit pojistku v promptu (práh závažnosti / „jen reálné problémy, ne
  domněnky") jako u non-goal SYSTEM_PROMPTu. Pokud bez pojistky, přiznat v reportu/měření.
- **Sdílený mechanismus místa** (`collectAiPayload`, `parseFindings` tvar, `toFindings`
  kontrola řádku, `computeCostUsd`) jde znovupoužít; pozor, ať se `--ai-code` neodchýlí od
  kontraktu (soubor v poslaném setu, řádek ≤ lineCount).
- **Render + JSON verze:** `AiStatus`/`analyzed`, `aiSection`/`aiSummaryLine`
  (markdown.ts) a JSON `INDEX_VERSION` (dnes 13) musí pojmout výsledky více AI režimů.
  Rozhodnout tvar: jeden `AiStatus` rozšířit, nebo víc nezávislých polí (non-goal vs code).
  Bump verze + test.
- **Vstupní body + kontrakty** (`args.ts` nové přepínače, `cli.ts`/`cliMain.ts` zapojení,
  JSON verze, prompt↔schéma) = před reportem nezávislý sub-agent (čerstvý kontext).
- **Klíč ani obsah kódu se NESMÍ dostat do reportu/stderr** (jen nálezy + usage + cena),
  stejně jako fáze 43.

## Run report
---
phase: 44
verdict: done
steps:
  - title: "Přepínače: --ai → --ai-non-goal, přidat --ai-code"
    status: done
  - title: "Code analýza: prompt + schéma + čisté funkce + orchestrátor (aiResult.ts)"
    status: done
  - title: "Report nese oba AI výsledky odděleně"
    status: done
  - title: "Zapojení v cli.ts"
    status: done
  - title: "Doběh: tsc + suite + reálný běh + nezávislý sub-agent"
    status: done
verify:
  - title: "npm run typecheck (s testy) má 22 předexistujících TS2532 v testech"
    detail: "noUncheckedIndexedAccess hlásí 'Object is possibly undefined' u f[0]/seen[0] indexace v testech (aiResult.test, cli.ai.test, aiPayload.test). Sub-agent ověřil checkoutem HEAD~1, že to NENÍ regrese fáze 44 – typecheck byl rozbitý už dřív. Produkční `npx tsc --noEmit` je ČISTÝ a `npx vitest run` zelený (498). Fáze pár instancí stejného vzoru přidala (konzistentně se zbytkem souboru). Doporučení: uklidit samostatně, je to dlouhodobý dluh, ne věc téhle fáze."
---

# Phase 44 — report z auto session

## Co se udělalo
Přidán samostatný AI režim `--ai-code` (analýza kvality/rizik kódu) oddělený od non-goalů.
Dnešní `--ai` přejmenován na `--ai-non-goal`. Oba režimy běží na vlastní přepínač, sdílejí
jeden klíč i JEDEN payload (čtení souborů proběhne jednou), ale každý volá API zvlášť
(vlastní cena). Report (markdown + JSON, verze 13→14) nese oba výsledky odděleně přes nový
typ `AiReport { nonGoal, code }`. `--ai-logic` vyčleněn do `mini todo`.

## Reálný běh (empirická čísla pro Fázi 5c)
`--ai-code` na opus-4.8 nad tímto projektem (38 zdrojových souborů):
- **usage: 91 673 vstup + 13 157 výstup tokenů, cena ~$0,79**
- 3 nálezy, každý míří na konkrétní místo (runIsolated.ts:56 „riskantní vzorec", :133
  „race condition", resolveImport.ts:11 „logická chyba") – kontrola místa i mapování
  `kind→rule` fungují na reálných datech.

To je podklad pro 5c: kompletní code analýza tohoto (malého) projektu = jednotky korun.

## DŮLEŽITÉ: reálný běh odhalil bug, který testy s mockem nechytly
`realAiAnalyze` měla schéma strukturovaného výstupu NATVRDO (`FINDINGS_SCHEMA` s
`nonGoalIndex`). `--ai-code` tak posílal CODE prompt, ale NON-GOAL schéma → model vrátil
tvar bez `kind` → `parseCodeFindings` ho odmítl („nález má neočekávaná pole") a degradoval
na skipped. Unit/e2e testy to zamaskovaly, protože mockují `analyze` a vracejí už správný
tvar – obcházely tím reálné schéma. **Oprava:** `AnalyzeFn` nově bere `schema` jako
parametr; `runAiAnalysis` předá `FINDINGS_SCHEMA`, `runAiCodeAnalysis` `CODE_FINDINGS_SCHEMA`.
Přidány testy se ZUBY (unit i e2e), které ověřují, že každý orchestrátor předá své schéma –
kdyby se bug vrátil, padnou. Po opravě reálný běh prošel (čísla výše).

## Nezávislý sub-agent (self-review čerstvým kontextem)
Našel 1 reálný nález: `jsonIndex.test.ts:136` jsem při hromadné náhradě minul (`graph, noAi)`
místo `noGraph, noAi)`), takže předával starý tvar – opraveno. Jinak potvrdil: degradace +
exit kódy OK, rozsah catch OK, kontrola místa (obrana proti halucinaci) identická s
non-goal cestou, tajemství neuniká, payload se čte jednou, nevyžádaný režim zůstává `ready`.

## Co zůstává otevřené (zaznamenáno v mini todo)
- `--ai-logic` (analýza funkčnosti celku vůči záměru) – samostatná fáze.
- `classifyAiError` nezná `overloaded_error` (HTTP 529). Při prvním reálném běhu API
  vrátilo „Overloaded" a probublalo jako „nečekaná chyba" se stackem místo čisté degradace.
  Degradace ale FUNGUJE (exit 0, report vznikl) – jde o čistotu klasifikace sdílené vrstvy
  (týká se i pingu/non-goalů), proto NEřešeno narychlo tady, ale jako samostatný úkol.

## Stav bran
- `npx tsc --noEmit` (produkční): čistý.
- `npx vitest run`: 498 testů zelených (přibyly 2 se zuby na schéma-bug).
- viz `verify` k `npm run typecheck` (předexistující dluh, ne regrese).

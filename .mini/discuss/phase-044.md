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

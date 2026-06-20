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

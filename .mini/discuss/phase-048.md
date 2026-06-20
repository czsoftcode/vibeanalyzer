# Phase 48 — Zprovoznit glm pro --ai-code

## Intent
glm dnes u `--ai-code` vždy skončí `skipped` (placené, k ničemu), protože Z.ai endpoint
NEvynucuje `output_config.format`. Cílem je, aby `--ai-code --ai-model=glm` na malém
projektu vrátil REÁLNÉ nálezy (ne skipped). Jen režim `--ai-code`; `--ai-non-goal` a
`--ai-logic` jsou vědomě follow-up (analogický prompt/parser, ale samostatná živá cena).

## Diagnóza (zachyceno živým během pod REÁLNÝM SYSTEM_PROMPT_CODE + CODE_FINDINGS_SCHEMA)
glm vrátil věcně SPRÁVNÉ nálezy (dělení nulou, NaN z parseInt), ale ve špatném TVARU:
1. **Holé pole** `[ {...}, {...} ]` místo obalu `{ "findings": [...] }` → parseCodeFindings
   padá hned na top-level kontrole (`data.findings` není pole).
2. **Chybí `severity`** → parser vyžaduje `error|warning|info`, glm ho vynechal.

Proč: `SYSTEM_PROMPT_CODE` v próze zmiňuje `file/line/kind/message`, ale `severity` ani
obal `{findings:[...]}` NEUVÁDÍ — spoléhá na vynucené schéma, které Z.ai ignoruje. glm
poslušně dodal přesně to, co prompt slovně žádal. Tedy: **tvrdší prompt to vyřeší**;
tolerantní MAPOVÁNÍ polí (riziko halucinací) NEPOTŘEBUJEME a do scope nepatří.

## Key decisions
- **Hlavní oprava = tvrdší prompt (sdílený).** Do `SYSTEM_PROMPT_CODE` přidat explicitní
  kontrakt tvaru: vrať JSON `{ "findings": [ { "file", "line", "kind", "severity":
  "error|warning|info", "message" } ] }` + krátký NEUTRÁLNÍ příklad + význam `severity`.
  Sdílené, neutrální pro opus/sonnet (jen zpřesní; ti dál vynucují schéma přes
  output_config.format → žádná regrese).
- **Parser přijme OBA obaly (rozhodnuto).** `parseCodeFindings` přijme `{findings:[...]}`
  i holé `[...]` (rozbalí). BEZPEČNÁ tolerance (žádné vymýšlení polí), chytne pozorovaný
  glm fail i při občasném nedeterminismu modelu. Platí pro všechny modely.
- **`severity` zůstává STRIKTNÍ.** Chybí-li, nález se ODMÍTNE – žádné doplňování defaultu
  (to by byla fabrikace, jde proti principu „každý nález ověřitelný"). Vynutit ho promptem.
- **Akceptační brána:** živý `--ai-code --ai-model=glm` na malém projektu → ≥1 reálný nález
  (ne skipped), každý s platnou `severity` a ověřeným místem (`file` v poslaném setu,
  `line` ≤ počet řádků).

## Watch out for
- **Neregresnout opus/sonnet.** Příklad v promptu je aditivní; oba dál jedou s vynuceným
  schématem. Existující parse unit testy MUSÍ projít beze změny. Riziko, že model „echne"
  příklad z promptu jako nález → příklad držet minimální/neutrální (ne vypadat jako reálný
  finding ke zkopírování).
- **Změna parseru jen pro code.** `parseFindings` (non-goal) a `parseLogicFindings` (logic)
  mají STEJNÝ envelope vzorec, ale tato fáze mění JEN `parseCodeFindings` + `SYSTEM_PROMPT_CODE`.
  Unwrap obalu klidně vytáhnout do sdíleného helperu, ale zapojit ho TEĎ jen do code parseru
  (zapojení do ostatních dvou = follow-up, jinak měníš jejich chování mimo scope).
- **Testy se zuby:** (1) `parseCodeFindings` přijme holé `[...]` i `{findings:[...]}` se
  stejným výsledkem; (2) položka bez `severity` se ODMÍTNE (hodí), ne tiše doplní; (3) položka
  s neplatnou severity se odmítne. Když dočasně rozbiju unwrap, test #1 padne.
- **Pokud glm i po tvrdším promptu vynechá `severity`** → nález se odmítne → zase skipped.
  To odhalí jen živá brána. Řešení NENÍ defaultovat severity (fabrikace), ale zesílit prompt.
  Připustit, že úplná spolehlivost glm bez vynuceného schématu není zaručená.
- **Cena:** každé živé ověření glm je placené – držet testovací projekt malý.
- **classifyAiError** (todo 12) je mimo rozsah: špatný tvar dál probublá jako „nečekaná
  chyba" se stackem a degraduje (exit 0). Čistota klasifikace se tu neřeší.
- **Adversarial sub-agent:** fáze mění PARSER (kontrakt výstup modelu → naše typy) a prompt
  → před reportem nezávislý self-review (čerstvý kontext).

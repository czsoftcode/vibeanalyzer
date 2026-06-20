# Phase 48 — Zprovoznit glm pro --ai-code

**Goal:** --ai-code --ai-model=glm na malém projektu vrátí reálné nálezy (ne skipped) tím, že do system promptu přidáme explicitní kontrakt tvaru JSON výstupu + příklad (sdílené, neutrální pro opus/sonnet, které dál vynucují schéma přes output_config.format). Mechanismus se zvolí až po zachycení reálné glm odpovědi pod reálným promptem+schématem (první krok). Bezpečná cesta (tvrdší prompt) má přednost; tolerantní parser jen jako eskalace, pokud prompt nestačí (riziko halucinací – nálezy musí dál mířit na ověřitelné místo). Režimy --ai-non-goal a --ai-logic zůstávají vědomě mimo rozsah (follow-up), aby fáze byla malá a neplatila 3× za živé ověření.

## Steps
- [done] Tvrdší SYSTEM_PROMPT_CODE: explicitní tvar + severity
- [done] parseCodeFindings přijme holé pole i obal
- [done] Živá akceptační brána glm + self-review

## Auto-commit
- Phase 48: Zprovoznit glm pro --ai-code

## Discussion
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

## Run report
---
phase: 48
verdict: done
steps:
  - title: "Tvrdší SYSTEM_PROMPT_CODE: explicitní tvar + severity"
    status: done
  - title: "parseCodeFindings přijme holé pole i obal"
    status: done
  - title: "Živá akceptační brána glm + self-review"
    status: done
verify:
  - title: "opus --ai-code se nezměnil novým promptem (živě ověřen jen sonnet)"
    detail: "Regresní sanity jsem pustil živě na sonnet (2 nálezy, exit 0, bez regrese). opus jede stejnou Anthropic cestou se stejným output_config.format, takže je reprezentován – ale samostatný živý opus běh jsem kvůli ceně nedělal. Když budeš opus reálně používat, mrkni, že --ai-code dál vrací nálezy."
---

# Phase 48 — report z auto session

## Výsledek: glm u --ai-code FUNGUJE (akceptační brána prošla)
Živý `--ai-code --ai-model=glm` na malém projektu vrátil **3 reálné nálezy** (ne skipped),
každý s platnou `severity`, ověřeným místem (`src/calc.ts:2`, `:8` – bez značky „místo
neověřeno"), druhem i popisem. Nálezy věcně správné (dělení nulou, chybějící `res.ok`,
URL injection bez encodeURIComponent). Cena ~$0,005. 562 testů zelených, build čistý.

## Jak se to vyvíjelo (dvě vrstvy problému, obě řešené bezpečně)
Diagnóza z diskuse byla jen půlka pravdy. Po jednotlivých opravách se odkryla druhá:

1. **Tvar položek + obal:** `SYSTEM_PROMPT_CODE` nikde neuváděl `severity` ani obal
   `{findings:[...]}` (spoléhal na vynucené schéma, které Z.ai ignoruje). → Přidán
   explicitní kontrakt tvaru + `severity` enum + neutrální příklad s placeholdery. To
   srovnalo vnitřek: glm začal vracet správný obal i severity.
2. **Markdown code fence (odkryto až živým během po opravě 1):** jakmile prompt explicitně
   žádá JSON, glm odpovídá zabalené do ` ```json … ``` ` → `JSON.parse` padl na backticku.
   → `unwrapFindings` teď nejdřív sloupne vnější code fence (`stripJsonCodeFence`), pak
   přijme OBA obaly (`{findings:[...]}` i holé `[...]`). Bezpečná tolerance: jen sjednocuje
   obal, NEvymýšlí ani nemapuje pole – striktní validace položek (vč. severity) zůstala.

Druhá vrstva nebyla v plánu, ale je ve stejné bezpečné třídě (žádná fabrikace) a přímo
v cíli fáze – odkryla ji až živá brána. Do promptu jsem navíc přidal „vrať čistý JSON bez
code fence" (šetří tokeny), ale strip je obranná pojistka bez ohledu na to.

## severity zůstala striktní (žádná fabrikace)
Když položka nemá `severity` nebo má neplatnou, parser HODÍ – žádné defaultování. To drží
princip „každý nález ověřitelný". Pokryto testy se zuby (mutace „dosaď default" zabila 2 testy).

## Co je MIMO rozsah (follow-up)
- `--ai-non-goal` a `--ai-logic`: `parseFindings`/`parseLogicFindings` zůstaly bajt-identické
  (přímý `JSON.parse` bez fence stripu). Pokud u nich glm narazí na fence/holé pole, spadnou
  do `skipped`. `unwrapFindings` je sdílená a exportovaná, takže zapojení do těch dvou je
  levný follow-up (vlastní živá cena za ověření každého režimu).
- `classifyAiError` (todo 12) neřešen: špatný tvar dál probublá jako „nečekaná chyba" se
  stackem a degraduje (exit 0).

## Nezávislý review
Pustil jsem nezávislého sub-agenta (čerstvý kontext) na parser/prompt kontrakt; sám si
odmutoval testy (strip, holé pole, default severity – každá mutace zabila testy). **Žádný
blocker.** Jediné reziduum: pravděpodobnostní vliv příkladu v promptu na opus/sonnet se
schématem – ale příklad má placeholdery (`<číslo>` není integer → schéma i parser by ho
odmítly), takže nejhůř způsobí `skipped`, ne falešný nález. Sanity sonnet běh to potvrdil
(2 nálezy, bez regrese).
